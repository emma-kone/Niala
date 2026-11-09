"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, ChevronRight, FileText, Loader2, Play, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { planHref } from "@/features/agenda/types";
import { DIFFICULTY_LABEL, EXERCISE_ORIGIN_LABEL, MODE_META, TYPE_LABEL, type QuestionType } from "@/server/domain/exercise-types";
import { levelText } from "@/config/academic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { exercisesBase, fmtPoints, type ExerciseDetail } from "./types";
import { confirmAction } from "@/components/notifications";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const STATUS = { IN_PROGRESS: "En cours", SUBMITTED: "En correction", GRADED: "Corrigée" } as const;

export default function ExerciseView({ subjectId, exerciseId }: { subjectId: string | null; exerciseId: string }) {
  const router = useRouter();
  const base = exercisesBase(subjectId);
  const [ex, setEx] = useState<ExerciseDetail | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ exercise: ExerciseDetail }>(`/api/exercises/${exerciseId}`);
      setEx(r.exercise);
      setError(null);
    } catch (e) {
      setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    }
  }, [exerciseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function start(fresh: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.post<{ id: string }>(`/api/exercises/${exerciseId}/attempts`, { fresh });
      router.push(`${base}/${exerciseId}/tentatives/${r.id}`);
    } catch (e) {
      setActionError(errText(e, "Impossible de démarrer."));
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await confirmAction("Supprimer cet exercice ? Vos tentatives passées restent consultables.", { confirmLabel: "Supprimer" }))) return;
    try {
      await api.del(`/api/exercises/${exerciseId}`);
      router.push(base);
    } catch (e) {
      setActionError(errText(e, "Suppression impossible."));
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">{error.status === 404 ? "Exercice introuvable" : "Chargement impossible"}</h1>
        <p className="typo-subtitle mt-2">{error.message}</p>
        <Button asChild variant="outline" className="mt-6"><Link href={base}>Retour aux exercices</Link></Button>
      </div>
    );
  }
  if (!ex) return <div className="mx-auto max-w-3xl space-y-3 px-4 py-8" aria-busy><Skeleton className="h-8 w-72" /><Skeleton className="h-40 rounded-xl" /></div>;

  const inProgress = ex.attempts.find((a) => a.status === "IN_PROGRESS");
  const byType = ex.questions.reduce<Record<string, number>>((m, q) => ({ ...m, [q.type]: (m[q.type] ?? 0) + 1 }), {});

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <nav aria-label="Fil d'Ariane" className="mb-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {subjectId && ex.subject ? (
          <>
            <Link href={routes.subjects} className="hover:text-foreground">Mes matières</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            <Link href={routes.subject(subjectId)} className="hover:text-foreground">{ex.subject.name}</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            <Link href={base} className="hover:text-foreground">Exercices</Link>
          </>
        ) : (
          <Link href={routes.exercises} className="hover:text-foreground">Exercices</Link>
        )}
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="typo-h1">{ex.title}</h1>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={planHref({ title: ex.title, type: "EXERCICE", subjectId, exerciseId })}><CalendarPlus className="h-4 w-4" aria-hidden /> Planifier</Link>
        </Button>
      </div>
      <p className="typo-subtitle mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{EXERCISE_ORIGIN_LABEL[ex.origin] ?? "Exercice"}</span>
        {ex.config.free && <span>{ex.config.free.subject} · {ex.config.free.chapter}{ex.config.free.level ? ` · ${levelText(ex.config.free.level) ?? ex.config.free.level}` : ""}</span>}
        {ex.document ? (
          subjectId ? (
            <Link href={`${routes.subject(subjectId)}/documents/${ex.document.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><FileText className="h-3.5 w-3.5" aria-hidden /> {ex.document.name}{ex.versionNumber ? ` (version ${ex.versionNumber})` : ""}</Link>
          ) : (
            <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" aria-hidden /> {ex.document.name}</span>
          )
        ) : ex.origin !== "FREE" ? (
          <span>Document source supprimé</span>
        ) : null}
        {ex.config.sources.length > 1 && <span>et {ex.config.sources.length - 1} autre{ex.config.sources.length > 2 ? "s" : ""} document{ex.config.sources.length > 2 ? "s" : ""}</span>}
        <span>Créé le {new Date(ex.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}</span>
      </p>
      <p className="typo-meta mt-1">
        {ex.config.correctionMode === "immediate" ? "Correction expliquée après chaque réponse" : "Correction détaillée à la fin"}
        {ex.config.mode ? ` · mode ${MODE_META[ex.config.mode].label}` : ""}
        {ex.config.practicePercent !== null ? ` · ${100 - ex.config.practicePercent} % théorie, ${ex.config.practicePercent} % pratique` : ""}
      </p>

      {ex.notice && <p role="note" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{ex.notice}</p>}

      <section aria-label="Contenu" className="mt-5 rounded-xl border bg-card p-4">
        <p className="text-sm"><strong>{ex.questions.length}</strong> question(s) · <strong>{fmtPoints(ex.totalPoints)}</strong> points{ex.requested && ex.requested !== ex.questions.length ? ` (${ex.requested} demandées)` : ""}{ex.config.difficulty ? ` · difficulté ${DIFFICULTY_LABEL[ex.config.difficulty as keyof typeof DIFFICULTY_LABEL] ?? ex.config.difficulty}` : ""}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(byType).map(([t, n]) => <Badge key={t} variant="outline" className="font-normal">{TYPE_LABEL[t as QuestionType]} × {n}</Badge>)}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {inProgress ? (
            <Button className="gap-2" onClick={() => router.push(`${base}/${exerciseId}/tentatives/${inProgress.id}`)}><Play className="h-4 w-4" aria-hidden /> Reprendre ({inProgress.answered} réponse(s) enregistrée(s))</Button>
          ) : (
            <Button className="gap-2" onClick={() => void start(false)} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} {ex.attempts.length ? "Nouvelle tentative" : "Commencer"}</Button>
          )}
          {inProgress && <Button variant="outline" className="gap-2" onClick={() => void start(true)} disabled={busy}><RotateCcw className="h-4 w-4" aria-hidden /> Recommencer à zéro</Button>}
          <Button variant="ghost" className="ml-auto gap-2 text-destructive" onClick={() => void remove()}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>
        </div>
        {actionError && <p role="alert" className="mt-2 text-sm text-destructive">{actionError}</p>}
      </section>

      <section aria-label="Historique" className="mt-6">
        <h2 className="typo-h3 mb-2">Tentatives</h2>
        {ex.attempts.length === 0 ? (
          <p className="typo-subtitle">Aucune tentative pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {ex.attempts.map((a) => (
              <li key={a.id}>
                <Link href={`${base}/${exerciseId}/tentatives/${a.id}`} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                  <span className="font-medium">{new Date(a.startedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <Badge variant="outline" className="font-normal">{STATUS[a.status]}</Badge>
                  <span className="ml-auto font-semibold">{a.status === "GRADED" ? `${fmtPoints(a.score)} / ${fmtPoints(a.maxScore)}` : `${a.answered} / ${ex.questions.length} répondues`}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
