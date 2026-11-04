"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { DIFFICULTIES, DIFFICULTY_LABEL, POINT_STEP, QUESTION_TYPES, TYPE_LABEL, type QuestionType } from "@/server/domain/exercise-types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourcesPicker, type ExtraSource } from "./sources-picker";
import { fmtPoints, type ExerciseOptions } from "./types";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
type Scale = "10" | "20" | "100" | "custom";
type Coverage = "all" | "sections" | "concepts" | "hard";
const HINT: Partial<Record<QuestionType, string>> = {
  code: "Corrigé par lecture (les tests d'exécution relèvent du laboratoire de code).",
  sql: "Corrigé par comparaison à la requête de référence.",
  practical: "À proposer seulement si le cours contient des exercices ou des procédures.",
};

export type Adaptation = "edge_cases" | "compare" | "harder" | "prerequisite";
export const ADAPTATIONS = new Set<string>(["edge_cases", "compare", "harder", "prerequisite"]);
const ADAPTATION_TEXT: Record<Adaptation, string> = {
  edge_cases: "Exercice adapté : questions de raisonnement qui testent les cas limites (vide, zéro, bornes).",
  compare: "Exercice adapté : questions qui font distinguer et comparer des notions voisines.",
  harder: "Exercice adapté : difficulté supérieure, situations nouvelles ou combinant plusieurs notions.",
  prerequisite: "Exercice adapté : questions de base pour consolider un prérequis fragile.",
};

export default function CreateExerciseView({ subjectId, documentId, presetConcepts = [], adaptation, withDocuments = [] }: { subjectId: string; documentId: string | null; presetConcepts?: string[]; adaptation?: Adaptation; withDocuments?: string[] }) {
  const router = useRouter();
  const [opts, setOpts] = useState<ExerciseOptions | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [title, setTitle] = useState("");
  const [count, setCount] = useState("10");
  const [scale, setScale] = useState<Scale>("20");
  const [custom, setCustom] = useState("15");
  const [types, setTypes] = useState<Set<QuestionType>>(new Set(["qcm_single", "true_false", "short_answer"]));
  const [coverage, setCoverage] = useState<Coverage>("all");
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set());
  const [conceptIds, setConceptIds] = useState<Set<string>>(new Set());
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("progressive");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [extras, setExtras] = useState<ExtraSource[]>([]);
  const [transversal, setTransversal] = useState(true);

  useEffect(() => {
    if (!documentId) return setError({ message: "Aucun document choisi. Ouvrez un document et utilisez « Créer un exercice »." });
    api
      .get<ExerciseOptions>(`/api/files/${documentId}/exercise-options`)
      .then((o) => {
        if (o.document.subjectId !== subjectId) throw Object.assign(new Error("Document introuvable."), { status: 404 });
        setOpts(o);
        // Suggestion de la progression : notions préchoisies (uniquement celles réellement présentes dans l'analyse)
        const valid = presetConcepts.filter((id) => o.concepts.some((c) => c.id === id));
        if (valid.length) {
          setCoverage("concepts");
          setConceptIds(new Set(valid));
          setCount("5");
        }
      })
      .catch((e) => setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, subjectId]);

  // Sources déjà choisies ailleurs (espace général des exercices) : résolues parmi les documents de l'étudiant
  useEffect(() => {
    if (!withDocuments.length) return;
    let cancelled = false;
    api
      .get<{ documents: { id: string; name: string; subjectName: string | null; analyzed: boolean }[] }>("/api/exercises/sources")
      .then((r) => {
        if (cancelled) return;
        const picked = withDocuments.filter((id) => id !== documentId).map((id) => r.documents.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d);
        setExtras(picked.map((d) => ({ documentId: d.id, name: d.name, subjectName: d.subjectName, analyzed: d.analyzed, mode: "all" as const, sectionIds: [] })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withDocuments.join(","), documentId]);

  const total = scale === "custom" ? Number(custom.replace(",", ".")) : Number(scale);
  const n = Number(count);
  const problems = useMemo(() => {
    const p: string[] = [];
    if (!opts) return p;
    if (!Number.isInteger(n) || n < 1) p.push("Indiquez un nombre de questions.");
    else if (n > opts.maxQuestions) p.push(`Maximum ${opts.maxQuestions} questions.`);
    if (!Number.isFinite(total) || total <= 0) p.push("Indiquez un barème.");
    else if (total > 100) p.push("Le barème est limité à 100 points.");
    else if (Math.abs(total / POINT_STEP - Math.round(total / POINT_STEP)) > 1e-9) p.push("Le barème doit être un multiple de 0,25.");
    else if (Number.isInteger(n) && n >= 1 && total / POINT_STEP < n) p.push("Barème trop petit : 0,25 point minimum par question.");
    if (types.size === 0) p.push("Choisissez au moins un type de question.");
    if (coverage === "sections" && sectionIds.size === 0) p.push("Choisissez au moins une section.");
    if (coverage === "concepts" && conceptIds.size === 0) p.push("Choisissez au moins une notion.");
    if (extras.some((x) => x.mode === "sections" && x.sectionIds.length === 0)) p.push("Choisissez au moins une section pour chaque source en mode « sections choisies ».");
    return p;
  }, [opts, n, total, types, coverage, sectionIds, conceptIds, extras]);

  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!opts || problems.length) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await api.post<{ id: string }>("/api/exercises", {
        documentId: opts.document.id,
        title: title.trim() || undefined,
        questionCount: n,
        totalPoints: total,
        types: [...types],
        coverage: { mode: coverage, ...(coverage === "sections" ? { sectionIds: [...sectionIds] } : {}), ...(coverage === "concepts" ? { conceptIds: [...conceptIds] } : {}) },
        difficulty,
        ...(adaptation ? { adaptation } : {}),
        ...(extras.length ? { extraSources: extras.map((x) => ({ documentId: x.documentId, coverage: { mode: x.mode, ...(x.mode === "sections" ? { sectionIds: x.sectionIds } : {}) } })), transversal } : {}),
      });
      router.push(`${routes.subject(subjectId)}/exercices/${r.id}`);
    } catch (err) {
      setSubmitError(errText(err, "La génération a échoué."));
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">{error.status === 404 ? "Document introuvable" : "Création impossible"}</h1>
        <p className="typo-subtitle mt-2">{error.message}</p>
        <Button asChild variant="outline" className="mt-6"><Link href={routes.subject(subjectId)}>Retour à la matière</Link></Button>
      </div>
    );
  }
  if (!opts) return <div className="mx-auto max-w-2xl space-y-3 px-4 py-8" aria-busy><Skeleton className="h-8 w-72" /><Skeleton className="h-96 rounded-xl" /></div>;

  const hasAnalysis = !!opts.analysis;
  const per = Number.isInteger(n) && n > 0 && total > 0 ? total / n : null;
  const blocked = !opts.aiConfigured || !opts.document.ready;

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <Link href={`${routes.subject(subjectId)}/documents/${opts.document.id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Retour au document</Link>
      <h1 className="typo-h1">Créer un exercice</h1>
      <p className="typo-subtitle mt-1">{extras.length === 0 ? <>Source de départ : <strong>{opts.document.name}</strong>. Aucun autre document n'est utilisé tant que vous n'en ajoutez pas ci-dessous.</> : <>{extras.length + 1} sources : <strong>{opts.document.name}</strong>{extras.map((x) => <span key={x.documentId}> · <strong>{x.name}</strong></span>)}. Aucun autre document n'est utilisé.</>}</p>

      {adaptation && <p role="note" className="mt-4 rounded-lg border border-violet-500/40 bg-violet-500/5 p-3 text-sm">{ADAPTATION_TEXT[adaptation]} Le barème et le nombre de questions restent ceux que vous choisissez ci-dessous ; les questions déjà travaillées ne sont pas reposées.</p>}
      {!opts.aiConfigured && <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Le service d&apos;IA n&apos;est pas configuré (variable <code>GEMINI_API_KEY</code>) : la génération d&apos;exercices est indisponible.</p>}
      {!opts.document.ready && <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Le texte de ce document n&apos;a pas pu être extrait : impossible de créer un exercice.</p>}

      <div className="mt-6 space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="ex-title">Titre (facultatif)</Label>
          <Input id="ex-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={`Exercice — ${opts.document.name}`} />
        </div>

        <SourcesPicker primary={{ id: opts.document.id, name: opts.document.name }} value={extras} onChange={setExtras} transversal={transversal} onTransversal={setTransversal} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ex-count">Nombre de questions</Label>
            <Input id="ex-count" type="number" min={1} max={opts.maxQuestions} value={count} onChange={(e) => setCount(e.target.value)} />
            <p className="typo-meta">Maximum {opts.maxQuestions}. Si les sources ne fournissent pas assez de matière, l&apos;exercice contiendra moins de questions (rien n&apos;est inventé).</p>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Barème (total des points)</legend>
            <div className="flex flex-wrap gap-2">
              {(["10", "20", "100", "custom"] as Scale[]).map((s) => (
                <label key={s} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", scale === s && "border-primary bg-primary/5")}>
                  <input type="radio" name="scale" checked={scale === s} onChange={() => setScale(s)} />
                  {s === "custom" ? "Personnalisé" : `Sur ${s}`}
                </label>
              ))}
            </div>
            {scale === "custom" && <Input aria-label="Barème personnalisé (maximum 100)" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} className="w-32" />}
            <p className="typo-meta">La somme des points des questions est exactement égale au barème.</p>
          </fieldset>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Types de questions</legend>
          <p className="typo-meta">Seuls les types cochés seront utilisés.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {QUESTION_TYPES.map((t) => (
              <label key={t} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm", types.has(t) && "border-primary bg-primary/5")}>
                <Checkbox checked={types.has(t)} onCheckedChange={(c) => setTypes(toggle(types, t, c === true))} className="mt-0.5" />
                <span>{TYPE_LABEL[t]}{HINT[t] && <span className="typo-meta block">{HINT[t]}</span>}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Couverture du cours</legend>
          {([
            ["all", "Tout le document", true],
            ["sections", "Certaines sections", hasAnalysis && opts.sections.length > 0],
            ["concepts", "Certaines notions", hasAnalysis && opts.concepts.length > 0],
            ["hard", "Les notions difficiles ou principales", hasAnalysis && opts.concepts.length > 0],
          ] as [Coverage, string, boolean][]).map(([v, label, ok]) => (
            <label key={v} className={cn("flex items-center gap-2 text-sm", !ok && "opacity-50")}>
              <input type="radio" name="coverage" checked={coverage === v} disabled={!ok} onChange={() => setCoverage(v)} />
              {label}
              {!ok && <span className="typo-meta">— {hasAnalysis ? "aucune notion extraite" : "analysez d'abord le document"}</span>}
            </label>
          ))}
          {coverage === "sections" && (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2" aria-label="Sections">
              {opts.sections.map((s) => (
                <li key={s.id} style={{ paddingLeft: s.level * 14 }}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={sectionIds.has(s.id)} onCheckedChange={(c) => setSectionIds(toggle(sectionIds, s.id, c === true))} />
                    {s.numbering && <span className="text-xs font-semibold text-muted-foreground">{s.numbering}</span>} {s.label}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {coverage === "concepts" && (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2" aria-label="Notions">
              {opts.concepts.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={conceptIds.has(c.id)} onCheckedChange={(v) => setConceptIds(toggle(conceptIds, c.id, v === true))} />
                    {c.name}{c.importance === 3 && <span className="typo-meta">principale</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {coverage === "hard" && <p className="typo-meta">Notions que vous maîtrisez le moins ; à défaut d&apos;historique, notions principales du cours.</p>}
        </fieldset>

        <div className="space-y-1.5">
          <Label>Difficulté</Label>
          <Select value={difficulty} onValueChange={(v) => setDifficulty(v as typeof difficulty)}>
            <SelectTrigger aria-label="Difficulté" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{DIFFICULTY_LABEL[d]}</SelectItem>)}</SelectContent>
          </Select>
          <p className="typo-meta">« Progressive » : de plus en plus difficile ; « Mélangée » : alternance. Les questions difficiles valent plus de points.</p>
        </div>
      </div>

      <div className="sticky bottom-0 mt-8 border-t bg-background/95 py-4 backdrop-blur">
        {problems.length > 0 && <ul role="alert" className="mb-2 text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {submitError && <p role="alert" className="mb-2 text-sm font-medium text-destructive">{submitError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <p className="typo-meta flex-1">{Number.isFinite(total) && n ? `${n} question(s) · ${fmtPoints(total)} points${per ? ` · ≈ ${fmtPoints(Math.round(per * 100) / 100)} pt/question` : ""}` : ""}</p>
          <Button type="submit" disabled={busy || blocked || problems.length > 0} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
            {busy ? "Génération en cours… (jusqu'à une minute)" : "Générer l'exercice"}
          </Button>
        </div>
      </div>
    </form>
  );
}
