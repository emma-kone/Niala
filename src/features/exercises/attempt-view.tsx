"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, FlaskConical, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { TYPE_LABEL } from "@/server/domain/exercise-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswerText, ExpectedText, QuestionInput } from "./question-input";
import { TestOutcomes } from "@/features/labs/test-outcomes";
import type { Diagnosis, TestOutcome, TestSummary } from "@/features/labs/types";
import { VERDICT_LABEL, fmtPoints, type AttemptDetail, type AttemptQuestion } from "./types";

type SaveState = "saved" | "saving" | "error";
const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const isFilled = (v: unknown) =>
  v != null && v !== "" && !(Array.isArray(v) && v.length === 0) && !(typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => !x));

export default function AttemptView({ subjectId, exerciseId, attemptId }: { subjectId: string; exerciseId: string; attemptId: string }) {
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [current, setCurrent] = useState(1);
  const [answers, setAnswers] = useState<Record<number, unknown>>({});
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const pending = useRef<Map<number, unknown>>(new Map());
  const inFlight = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ attempt: AttemptDetail }>(`/api/attempts/${attemptId}`);
      setAttempt(r.attempt);
      setAnswers(Object.fromEntries(r.attempt.questions.map((q) => [q.position, q.answer])));
      setCurrent(r.attempt.status === "IN_PROGRESS" ? Math.min(Math.max(1, r.attempt.lastPosition || 1), r.attempt.questions.length) : 1);
      setError(null);
    } catch (e) {
      setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    }
  }, [attemptId]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Enregistrement automatique des réponses ──
  const flushOne = useCallback(
    async (position: number) => {
      const t = timers.current.get(position);
      if (t) clearTimeout(t);
      timers.current.delete(position);
      if (!pending.current.has(position)) return;
      const value = pending.current.get(position);
      pending.current.delete(position);
      inFlight.current++;
      setSave("saving");
      try {
        await api.put(`/api/attempts/${attemptId}/answers/${position}`, { value });
        setSaveError(null);
        if (inFlight.current === 1 && pending.current.size === 0) setSave("saved");
      } catch (e) {
        pending.current.set(position, value); // rien n'est perdu : on retentera
        setSave("error");
        setSaveError(errText(e, "Enregistrement impossible."));
      } finally {
        inFlight.current--;
      }
    },
    [attemptId]
  );
  const flushAll = useCallback(async () => {
    await Promise.all([...pending.current.keys()].map((p) => flushOne(p)));
  }, [flushOne]);

  const change = (position: number, value: unknown) => {
    setAnswers((a) => ({ ...a, [position]: value }));
    pending.current.set(position, value);
    setSave("saving");
    const old = timers.current.get(position);
    if (old) clearTimeout(old);
    timers.current.set(position, setTimeout(() => void flushOne(position), 600));
  };

  useEffect(() => {
    const onHide = () => {
      for (const [position, value] of pending.current) {
        void fetch(`/api/attempts/${attemptId}/answers/${position}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }), keepalive: true, credentials: "same-origin" }).catch(() => undefined);
      }
      pending.current.clear();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [attemptId]);

  async function go(position: number) {
    await flushAll();
    setCurrent(position);
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    if (!attempt) return;
    const missing = attempt.questions.filter((q) => !isFilled(answers[q.position])).length;
    if (missing > 0 && !window.confirm(`${missing} question(s) sans réponse. Terminer et corriger quand même ?`)) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await flushAll();
      if (pending.current.size > 0) throw new Error("Certaines réponses n'ont pas pu être enregistrées. Réessayez.");
      const r = await api.post<{ attempt: AttemptDetail }>(`/api/attempts/${attemptId}/submit`);
      setAttempt(r.attempt);
    } catch (e) {
      setActionError(errText(e, "La correction a échoué. Vos réponses sont conservées."));
    } finally {
      setSubmitting(false);
    }
  }

  async function regrade() {
    setSubmitting(true);
    setActionError(null);
    try {
      const r = await api.post<{ attempt: AttemptDetail }>(`/api/attempts/${attemptId}/regrade`);
      setAttempt(r.attempt);
      if (r.attempt.ungraded > 0) setActionError("Le service d'IA n'a pas pu corriger ces questions pour l'instant.");
    } catch (e) {
      setActionError(errText(e, "Correction impossible."));
    } finally {
      setSubmitting(false);
    }
  }

  async function again() {
    try {
      const r = await api.post<{ id: string }>(`/api/exercises/${exerciseId}/attempts`, { fresh: true });
      router.push(`${routes.subject(subjectId)}/exercices/${exerciseId}/tentatives/${r.id}`);
    } catch (e) {
      setActionError(errText(e, "Impossible de démarrer une nouvelle tentative (l'exercice a peut-être été supprimé)."));
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">{error.status === 404 ? "Tentative introuvable" : "Chargement impossible"}</h1>
        <p className="typo-subtitle mt-2">{error.message}</p>
        <Button asChild variant="outline" className="mt-6"><Link href={`${routes.subject(subjectId)}/exercices`}>Retour aux exercices</Link></Button>
      </div>
    );
  }
  if (!attempt) return <div className="mx-auto max-w-3xl space-y-3 px-4 py-8" aria-busy><Skeleton className="h-8 w-64" /><Skeleton className="h-64 rounded-xl" /></div>;

  const back = `${routes.subject(subjectId)}/exercices/${exerciseId}`;
  const total = attempt.questions.length;
  const graded = attempt.status === "GRADED";

  // ───────────────────────── Correction ─────────────────────────
  if (graded) {
    const pct = attempt.gradedMax ? Math.round(((attempt.score ?? 0) / attempt.gradedMax) * 100) : 0;
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Retour à l&apos;exercice</Link>
        <h1 className="typo-h1">{attempt.exercise.title}</h1>
        <p className="typo-subtitle mt-1">Correction de votre tentative du {new Date(attempt.startedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</p>

        <section aria-label="Résultat" className="my-5 rounded-xl border bg-card p-5">
          <p className="text-3xl font-bold">
            {fmtPoints(attempt.score)} <span className="text-lg font-medium text-muted-foreground">/ {fmtPoints(attempt.ungraded ? attempt.gradedMax : attempt.maxScore)}</span>
          </p>
          <Progress value={pct} className="mt-3 h-2" aria-label={`${pct} %`} />
          {attempt.ungraded > 0 && (
            <div role="note" className="mt-3 rounded-md border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
              <p><strong>{attempt.ungraded} question(s) non corrigée(s)</strong> : le score ci-dessus ne porte que sur les {fmtPoints(attempt.gradedMax)} points corrigés sur {fmtPoints(attempt.maxScore)}. Les réponses rédigées nécessitent le service d&apos;IA.</p>
              <Button size="sm" variant="outline" className="mt-2 gap-1.5 bg-background" onClick={() => void regrade()} disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Corriger maintenant
              </Button>
            </div>
          )}
          {actionError && <p role="alert" className="mt-2 text-sm text-destructive">{actionError}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button className="gap-2" onClick={() => void again()}><RotateCcw className="h-4 w-4" aria-hidden /> Refaire l&apos;exercice</Button>
            <Button asChild variant="outline"><Link href={back}>Voir l&apos;historique</Link></Button>
          </div>
        </section>

        <ol className="space-y-4">
          {attempt.questions.map((q) => (
            <ResultCard key={q.position} q={q} subjectId={subjectId} exerciseId={exerciseId} documentId={attempt.exercise.documentId} />
          ))}
        </ol>
      </div>
    );
  }

  // ───────────────────────── Passage ─────────────────────────
  const q = attempt.questions[current - 1];
  const answered = attempt.questions.filter((x) => isFilled(answers[x.position])).length;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <Link href={back} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Quitter (vos réponses sont enregistrées)</Link>
        <span role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-xs", save === "error" ? "text-destructive" : "text-muted-foreground")} title={saveError ?? undefined}>
          {save === "saving" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {save === "saved" ? "Enregistré" : save === "saving" ? "Enregistrement…" : "Échec de l'enregistrement"}
          {save === "error" && <button className="underline" onClick={() => void flushAll()}>Réessayer</button>}
        </span>
      </div>
      <h1 className="typo-h2">{attempt.exercise.title}</h1>
      <div className="mt-3 flex items-center gap-3">
        <Progress value={(answered / total) * 100} className="h-2 flex-1" aria-label="Progression" />
        <span className="typo-meta whitespace-nowrap">{answered} / {total} répondues</span>
      </div>

      <nav aria-label="Questions" className="my-4 flex flex-wrap gap-1.5">
        {attempt.questions.map((x) => (
          <button
            key={x.position}
            type="button"
            onClick={() => void go(x.position)}
            aria-label={`Question ${x.position}${isFilled(answers[x.position]) ? " (répondue)" : ""}`}
            aria-current={current === x.position ? "step" : undefined}
            className={cn("h-8 min-w-8 rounded-md border px-2 text-xs font-medium", current === x.position ? "border-primary bg-primary text-primary-foreground" : isFilled(answers[x.position]) ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "hover:bg-muted")}
          >
            {x.position}
          </button>
        ))}
      </nav>

      <section aria-labelledby="question-title" className="rounded-xl border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{TYPE_LABEL[q.type]}</Badge>
          <span>{fmtPoints(q.points)} point{q.points > 1 ? "s" : ""}</span>
          <span>· {q.difficulty}</span>
        </div>
        <h2 id="question-title" className="mb-4 text-base font-semibold leading-relaxed">
          {q.type === "fill_choices" || q.type === "fill_blank" ? "Complétez la phrase :" : String(q.payload.statement)}
        </h2>
        <QuestionInput key={q.position} q={q} value={answers[q.position]} onChange={(v) => change(q.position, v)} />
      </section>

      {actionError && <p role="alert" className="mt-3 text-sm text-destructive">{actionError}</p>}
      <div className="mt-4 flex items-center justify-between">
        <Button variant="outline" className="gap-1.5" onClick={() => void go(current - 1)} disabled={current <= 1}><ArrowLeft className="h-4 w-4" aria-hidden /> Précédente</Button>
        {current < total ? (
          <Button className="gap-1.5" onClick={() => void go(current + 1)}>Suivante <ArrowRight className="h-4 w-4" aria-hidden /></Button>
        ) : (
          <Button className="gap-1.5" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />} Terminer et corriger
          </Button>
        )}
      </div>
      {current < total && (
        <div className="mt-6 text-center">
          <Button variant="ghost" size="sm" onClick={() => void submit()} disabled={submitting}>Terminer maintenant</Button>
        </div>
      )}
    </div>
  );
}

function LabLink({ exerciseId, position, kind }: { exerciseId: string; position: number; kind: "code" | "sql" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function open() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ workspace: { id: string } }>("/api/labs", { from: "question", exerciseId, position });
      router.push(`${kind === "sql" ? routes.sql : routes.code}/${r.workspace.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ouverture impossible.");
      setBusy(false);
    }
  }
  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" className="gap-2" onClick={() => void open()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="h-4 w-4" aria-hidden />} Retravailler dans le laboratoire</Button>
      {err && <p role="alert" className="mt-1 text-xs text-destructive">{err}</p>}
    </div>
  );
}

function ResultCard({ q, subjectId, exerciseId, documentId }: { q: AttemptQuestion; subjectId: string; exerciseId: string; documentId: string | null }) {
  const r = q.result;
  const tests = (r?.detail as { tests?: TestOutcome[]; summary?: TestSummary; diagnoses?: Diagnosis[] } | undefined);
  const v = VERDICT_LABEL[r?.verdict ?? "ungraded"];
  const statement = q.type === "fill_choices" || q.type === "fill_blank" ? String(q.payload.statement) : String(q.payload.statement);
  return (
    <li className={cn("rounded-xl border-l-4 border bg-card p-4", v.className.split(" ")[0])}>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-muted-foreground">Question {q.position}</span>
        <Badge variant="outline">{TYPE_LABEL[q.type]}</Badge>
        <Badge variant="outline" className={cn("ml-auto font-medium", v.className)}>{v.label}</Badge>
        <span className="font-semibold">{fmtPoints(r?.points)} / {fmtPoints(q.points)}</span>
      </div>
      <p className="font-medium">{statement}</p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Votre réponse</dt>
          <dd className="mt-0.5"><AnswerText q={q} /></dd>
        </div>
        {r && r.verdict !== "correct" && (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Réponse attendue</dt>
            <dd className="mt-0.5"><ExpectedText q={q} /></dd>
          </div>
        )}
      </dl>
      {r?.method === "tests" && tests?.tests && tests.summary && (
        <div className="mt-3"><p className="mb-1 text-xs text-muted-foreground">Correction par tests exécutés dans un environnement isolé (objective, sans IA).</p><TestOutcomes outcomes={tests.tests} summary={tests.summary} diagnoses={tests.diagnoses} /></div>
      )}
      {(q.type === "code" || q.type === "sql") && <LabLink exerciseId={exerciseId} position={q.position} kind={q.type} />}
      {r?.method === "keywords" && <p className="mt-2 text-xs text-muted-foreground">Correction automatique par mots-clés (le service d&apos;IA n&apos;était pas disponible) : à relire avec la réponse de référence.</p>}
      {r?.method === "ai" && <p className="mt-2 text-xs text-muted-foreground">Correction assistée par IA selon les critères de l&apos;exercice.</p>}
      {r?.verdict === "ungraded" && <p className="mt-2 text-xs text-violet-800 dark:text-violet-300">Cette réponse n&apos;a pas été corrigée. Comparez-la à la réponse de référence ci-dessus.</p>}
      {Array.isArray((r?.detail as { missing?: string[] } | undefined)?.missing) && (r!.detail as { missing: string[] }).missing.length > 0 && (
        <div className="mt-2 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ce qui manque</p><ul className="list-disc pl-5">{(r!.detail as { missing: string[] }).missing.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
      )}
      {r?.explanation && <p className="mt-3 rounded-md bg-muted/60 p-3 text-sm"><span className="font-semibold">Explication : </span>{r.explanation}</p>}
      {q.sourceRefs?.map((s, i) => (
        <p key={i} className="mt-2 border-l-2 border-emerald-500 pl-2 text-xs italic text-muted-foreground">
          « {s.quote} »{" "}
          {documentId && s.page && (
            <Link href={`${routes.subject(subjectId)}/documents/${documentId}?page=${s.page}`} className="not-italic text-primary hover:underline">
              Relire p. {s.page} <ExternalLink className="inline h-3 w-3" aria-hidden />
            </Link>
          )}
        </p>
      ))}
      {q.concepts && q.concepts.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">Notions : {q.concepts.map((c) => <span key={c.id} className="rounded-full bg-muted px-2 py-0.5">{c.name}</span>)}</p>
      )}
    </li>
  );
}
