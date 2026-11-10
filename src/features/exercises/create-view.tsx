"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileText, FolderOpen, Loader2, ListChecks, Plus, Repeat2, Sparkles, Upload, X, Zap } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { CORRECTION_MODES, DIFFICULTIES, DIFFICULTY_LABEL, EXERCISE_MODES, MAX_SOURCE_DOCUMENTS, MODE_META, POINT_STEP, PROGRAMMING_TYPES, QUESTION_TYPES, TYPE_LABEL, type CorrectionMode, type ExerciseMode, type QuestionType } from "@/server/domain/exercise-types";
import { OTHER_LEVEL, isLevelChoice } from "@/config/academic";
import { PROFILE_KEY, fetchProfile } from "@/features/profile/types";
import { useSettings } from "@/features/settings/use-settings";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubjectIcon } from "@/components/subject-icon";
import { uploadFiles, type UploadItem } from "@/features/subject-files/upload";
import { exercisesBase, fmtPoints, type ExerciseOptions } from "./types";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
type Scale = "10" | "20" | "100" | "custom";
type Coverage = "all" | "sections" | "concepts" | "hard";
interface Source {
  id: string;
  name: string;
  ready: boolean;
  /** Sujet d'exercices (TD, examen) ou cours : détecté à l'ajout du document. */
  kind: "sheet" | "course";
}
interface SubjectChoice {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
}

const HINT: Partial<Record<QuestionType, string>> = {
  code: "Corrigé par tests exécutés quand la solution de référence est vérifiable.",
  sql: "Corrigé par comparaison à la requête de référence.",
  practical: "À proposer seulement si le cours contient des exercices ou des procédures.",
};
const CORRECTION_LABEL: Record<CorrectionMode, { title: string; text: string; icon: typeof Zap }> = {
  immediate: { title: "En temps réel", text: "L'explication s'affiche après chaque réponse.", icon: Zap },
  final: { title: "À la fin", text: "Vous validez tout, puis l'IA détaille la correction.", icon: ListChecks },
};
const ACCEPTED_FILES = ".pdf,.docx,.pptx,.txt,.md";
/** Déduit des éléments fournis : rien à choisir pour l'étudiant. */
type SourceMode = "free" | "course" | "import";
const CARD = "rounded-3xl border bg-card p-5";

const sourceOf = (o: ExerciseOptions): Source => ({ id: o.document.id, name: o.document.name, ready: o.document.ready, kind: o.document.kind });
const optionsOf = (id: string) => api.get<ExerciseOptions>(`/api/files/${id}/exercise-options`);

/** Documents sources : ceux déjà rangés dans une matière, ou un fichier venu d'ailleurs importé à l'instant. */
function SourcesPicker({ subjectId, sources, onChange }: { subjectId: string | null; sources: Source[]; onChange: (update: (list: Source[]) => Source[]) => void }) {
  const [open, setOpen] = useState(false);
  const [subjects, setSubjects] = useState<SubjectChoice[]>([]);
  const [browsing, setBrowsing] = useState(subjectId ?? "");
  const [docs, setDocs] = useState<{ id: string; name: string }[] | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(0);
  const full = sources.length >= MAX_SOURCE_DOCUMENTS;

  useEffect(() => {
    api.get<{ subjects: SubjectChoice[] }>("/api/subjects").then((r) => { setSubjects(r.subjects); setBrowsing((b) => b || (r.subjects[0]?.id ?? "")); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!open || !browsing) return;
    let cancelled = false;
    api
      .get<{ documents: { id: string; name: string }[] }>(`/api/subjects/${browsing}/documents`)
      .then((r) => !cancelled && setDocs(r.documents))
      .catch(() => !cancelled && setDocs([]));
    return () => {
      cancelled = true;
      setDocs(null);
    };
  }, [open, browsing]);

  async function add(id: string) {
    setError(null);
    try {
      const source = sourceOf(await optionsOf(id));
      onChange((list) => (list.some((s) => s.id === id) || list.length >= MAX_SOURCE_DOCUMENTS ? list : [...list, source]));
    } catch (e) {
      setError(errText(e, "Ce document n'a pas pu être ajouté."));
    }
  }

  async function importFiles(files: File[]) {
    if (!files.length) return;
    // Plusieurs imports peuvent se chevaucher : la place restante tient compte des fichiers encore en cours de lecture.
    const room = Math.max(0, MAX_SOURCE_DOCUMENTS - sources.length - pending.current);
    const accepted = files.slice(0, room);
    pending.current += accepted.length;
    setError(files.length > room ? `${MAX_SOURCE_DOCUMENTS} documents maximum : les fichiers en trop n'ont pas été importés.` : null);
    const items = accepted.map((f, i): UploadItem => ({ key: `${f.name}-${i}-${Date.now()}`, name: f.name, phase: "waiting" }));
    setUploads((u) => [...u, ...items]);
    const finished = new Map<string, UploadItem>(items.map((i) => [i.key, i]));
    await uploadFiles(accepted, { subjectId, folderId: null }, (key, patch) => {
      finished.set(key, { ...finished.get(key)!, ...patch });
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    }, items.map((i) => i.key));
    for (const item of finished.values()) {
      if (item.phase === "done" && item.documentId) {
        await add(item.documentId);
        setUploads((u) => u.filter((x) => x.key !== item.key));
      }
      pending.current -= 1;
    }
  }

  const selected = new Set(sources.map((s) => s.id));

  return (
    <section aria-labelledby="ex-sources" className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ex-sources" className="font-semibold">Documents <span className="font-normal text-muted-foreground">(facultatif)</span></h2>
          <p className="typo-meta mt-0.5">Cours, TD, sujet d&apos;examen… Les questions ne s&apos;appuient que sur ces documents ({sources.length} / {MAX_SOURCE_DOCUMENTS}).</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {subjects.length > 0 && <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-full" disabled={full}><FolderOpen className="h-3.5 w-3.5" aria-hidden /> Mes matières</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-2 rounded-2xl p-3">
              <Select value={browsing} onValueChange={setBrowsing}>
                <SelectTrigger aria-label="Matière" className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}><span className="flex items-center gap-2"><SubjectIcon icon={s.icon} name={s.name} color={s.color} size="xs" /> {s.name}</span></SelectItem>)}</SelectContent>
              </Select>
              <ul className="max-h-60 space-y-px overflow-y-auto">
                {docs === null && <li className="px-2 py-1 text-xs text-muted-foreground">Chargement…</li>}
                {docs?.length === 0 && <li className="px-2 py-1 text-xs text-muted-foreground">Aucun document dans cette matière.</li>}
                {docs?.map((d) => (
                  <li key={d.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                      <Checkbox checked={selected.has(d.id)} disabled={!selected.has(d.id) && full} onCheckedChange={(c) => (c === true ? void add(d.id) : onChange((list) => list.filter((s) => s.id !== d.id)))} />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>}
          <input ref={input} type="file" multiple accept={ACCEPTED_FILES} className="hidden" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ""; void importFiles(files); }} />
          <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-full" disabled={full} onClick={() => input.current?.click()}><Upload className="h-3.5 w-3.5" aria-hidden /> Importer un fichier</Button>
        </div>
      </div>
      {sources.length === 0 && uploads.length === 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground"><Plus className="h-4 w-4 shrink-0" aria-hidden /> Aucun document : l&apos;exercice sera créé à partir de votre description. Vous pouvez importer un fichier (PDF, DOCX, PPTX, TXT, MD){subjects.length > 0 ? " ou choisir un document dans vos matières" : ""}.</p>
      )}
      {(sources.length > 0 || uploads.length > 0) && (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Documents choisis">
          {sources.map((s) => (
            <li key={s.id} className={cn("flex items-center gap-2 rounded-2xl bg-muted/50 py-2 pl-3 pr-2 text-sm", !s.ready && "ring-1 ring-destructive")}>
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={s.name}>{s.name}</span>
                {!s.ready && <span className="block text-xs text-destructive">Texte non extrait : document inutilisable</span>}
              </span>
              <button type="button" aria-label={`Retirer ${s.name}`} className="rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={() => onChange((list) => list.filter((x) => x.id !== s.id))}><X className="h-3.5 w-3.5" aria-hidden /></button>
            </li>
          ))}
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-2 rounded-2xl bg-muted/50 py-2 pl-3 pr-2 text-sm">
              {u.phase === "error" ? <X className="h-4 w-4 shrink-0 text-destructive" aria-hidden /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium" title={u.name}>{u.name}</span>
                <span className={cn("block text-xs", u.phase === "error" ? "text-destructive" : "text-muted-foreground")}>{u.phase === "error" ? (u.message ?? "Import impossible.") : "Import et lecture du fichier…"}</span>
              </span>
              {u.phase === "error" && <button type="button" aria-label={`Fermer ${u.name}`} className="rounded-full p-1 text-muted-foreground hover:bg-background" onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}><X className="h-3.5 w-3.5" aria-hidden /></button>}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </section>
  );
}

export default function CreateExerciseView({ subjectId, documentId, presetConcepts = [] }: { subjectId: string | null; documentId: string | null; presetConcepts?: string[] }) {
  const router = useRouter();
  const { settings } = useSettings();
  const { data: profile } = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchProfile });
  // Un seul formulaire pour les trois cas : la description seule (génération libre), des documents (cours) ou un sujet
  // d'exercices à reproduire. Le cas est déduit des éléments fournis et de la nature détectée du document.
  const [request, setRequest] = useState("");
  const [reproduceChoice, setReproduce] = useState<boolean | null>(null);
  // Niveau : celui du profil ; l'IA adapte la difficulté sans que l'étudiant ait à le ressaisir.
  // Le profil ne porte plus qu'une classe/filière libre (ex. « DASI 3 ») : elle sert de niveau.
  const level = OTHER_LEVEL;
  const levelOther = profile?.field?.trim() || "Non précisé";
  const [modeChoice, setMode] = useState<ExerciseMode | null>(null);
  const mode = modeChoice ?? settings?.defaultMode ?? "personnalise";
  const [keep, setKeep] = useState(true);
  const [setup, setSetup] = useState<{ aiConfigured: boolean; maxQuestions: number } | null>(null);
  const [opts, setOpts] = useState<ExerciseOptions | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [title, setTitle] = useState("");
  const [count, setCount] = useState("10");
  const [scale, setScale] = useState<Scale>("20");
  const [custom, setCustom] = useState("15");
  const [types, setTypes] = useState<Set<QuestionType>>(new Set(["qcm_single", "true_false", "short_answer"]));
  const [coverageChoice, setCoverage] = useState<Coverage | null>(null);
  const coverage: Coverage = coverageChoice ?? (mode === "revision" ? "hard" : "all");
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set());
  const [conceptIds, setConceptIds] = useState<Set<string>>(new Set());
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>("progressive");
  const [correctionChoice, setCorrectionMode] = useState<CorrectionMode | null>(null);
  const correctionMode = correctionChoice ?? settings?.correctionPref ?? "final";
  const [practice, setPractice] = useState(50);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ aiConfigured: boolean; maxQuestions: number }>("/api/exercises/setup").then(setSetup).catch((e) => setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status }));
    if (!documentId) return;
    optionsOf(documentId)
      .then((o) => {
        if (subjectId && o.document.subjectId !== subjectId) throw Object.assign(new Error("Document introuvable."), { status: 404 });
        setSources([sourceOf(o)]);
        // Suggestion de la progression : notions préchoisies (uniquement celles réellement présentes dans l'analyse)
        const valid = presetConcepts.filter((id) => o.concepts.some((c) => c.id === id));
        if (valid.length) {
          setCoverage("concepts");
          setConceptIds(new Set(valid));
          setCount("5");
        }
      })
      .catch((e) => setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status }));
  }, [documentId, subjectId]);

  // Sections et notions n'ont de sens que pour un document unique.
  const singleId = sources.length === 1 ? sources[0].id : null;
  useEffect(() => {
    if (!singleId) return;
    let cancelled = false;
    optionsOf(singleId).then((o) => !cancelled && setOpts(o)).catch(() => undefined);
    return () => {
      cancelled = true;
      setOpts(null);
    };
  }, [singleId]);

  // Tous les documents sont des sujets : ils sont reproduits ; un seul cours dans le lot suffit à créer de nouvelles questions.
  const detectedSheet = sources.length > 0 && sources.every((s) => s.kind === "sheet");
  const reproduce = sources.length > 0 && (reproduceChoice ?? detectedSheet);
  const sourceMode: SourceMode = sources.length === 0 ? "free" : reproduce ? "import" : "course";
  // « Révision ciblée » demande les notions fragiles, qui supposent un document déjà analysé.
  const effectiveCoverage: Coverage = singleId && (coverage !== "hard" || (opts?.concepts.length ?? 0) > 0) ? coverage : "all";
  const correctionLocked = mode === "examen";
  const effectiveCorrection: CorrectionMode = correctionLocked ? "final" : correctionMode;
  const total = scale === "custom" ? Number(custom.replace(",", ".")) : Number(scale);
  const n = Number(count);
  const showGauge = PROGRAMMING_TYPES.some((t) => types.has(t));
  const hasTheory = [...types].some((t) => t !== "code" && t !== "sql" && t !== "practical");
  const practicePercent = hasTheory ? practice : 100;
  const practiceCount = Number.isInteger(n) && n > 0 ? Math.round((n * practicePercent) / 100) : 0;

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!setup) return p;
    if (sourceMode === "free" && request.trim().length < 3) p.push("Décrivez ce que vous voulez travailler, ou ajoutez un document.");
    if (sources.some((s) => !s.ready)) p.push("Retirez les documents dont le texte n'a pas pu être extrait.");
    if (sourceMode === "import") {
      if (!Number.isFinite(total) || total <= 0 || total > 100) p.push("Indiquez un barème entre 0,25 et 100 points.");
      return p;
    }
    if (!Number.isInteger(n) || n < 1) p.push("Indiquez un nombre de questions.");
    else if (n > setup.maxQuestions) p.push(`Maximum ${setup.maxQuestions} questions.`);
    if (!Number.isFinite(total) || total <= 0) p.push("Indiquez un barème.");
    else if (total > 100) p.push("Le barème est limité à 100 points.");
    else if (Math.abs(total / POINT_STEP - Math.round(total / POINT_STEP)) > 1e-9) p.push("Le barème doit être un multiple de 0,25.");
    else if (Number.isInteger(n) && n >= 1 && total / POINT_STEP < n) p.push("Barème trop petit : 0,25 point minimum par question.");
    if (types.size === 0) p.push("Choisissez au moins un type de question.");
    if (sourceMode === "course" && effectiveCoverage === "sections" && sectionIds.size === 0) p.push("Choisissez au moins une section.");
    if (sourceMode === "course" && effectiveCoverage === "concepts" && conceptIds.size === 0) p.push("Choisissez au moins une notion.");
    return p;
  }, [setup, sources, n, total, types, effectiveCoverage, sectionIds, conceptIds, sourceMode, request]);

  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const common = { title: title.trim() || undefined, totalPoints: total, correctionMode: effectiveCorrection, mode, saved: keep };
      const generation = { ...common, questionCount: n, types: [...types], difficulty, ...(showGauge ? { practicePercent } : {}) };
      const r =
        sourceMode === "import"
          ? await api.post<{ id: string; subjectId: string | null }>("/api/exercises/import", { ...common, documentId: sources[0].id, documentIds: sources.map((s) => s.id) })
          : sourceMode === "free"
            ? await api.post<{ id: string; subjectId: string | null }>("/api/exercises", { ...generation, source: "free", subject: request.trim().slice(0, 120), chapter: request.trim().slice(0, 200), level, levelOther })
            : await api.post<{ id: string; subjectId: string | null }>("/api/exercises", {
                ...generation,
                ...(request.trim() ? { focus: request.trim().slice(0, 300) } : {}),
                documentId: sources[0].id,
                documentIds: sources.map((s) => s.id),
                coverage: { mode: effectiveCoverage, ...(effectiveCoverage === "sections" ? { sectionIds: [...sectionIds] } : {}), ...(effectiveCoverage === "concepts" ? { conceptIds: [...conceptIds] } : {}) },
              });
      router.push(`${exercisesBase(r.subjectId)}/${r.id}`);
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
        <Button asChild variant="outline" className="mt-6"><Link href={subjectId ? routes.subject(subjectId) : routes.exercises}>Retour</Link></Button>
      </div>
    );
  }
  if (!setup) return <div className="mx-auto max-w-6xl space-y-3 px-4 py-8" aria-busy><Skeleton className="h-8 w-72" /><Skeleton className="h-96 rounded-3xl" /></div>;

  const hasAnalysis = !!opts?.analysis;
  const per = Number.isInteger(n) && n > 0 && total > 0 ? total / n : null;
  const back = subjectId ? (documentId ? `${routes.subject(subjectId)}/documents/${documentId}` : routes.subject(subjectId)) : routes.exercises;
  const coverageReason = !singleId ? "un seul document requis" : hasAnalysis ? "aucune notion extraite" : "analysez d'abord le document";

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6">
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Retour</Link>
      <h1 className="typo-h1">Créer un exercice</h1>
      <p className="typo-subtitle mt-1">Décrivez ce que vous voulez travailler, déposez un cours ou un TD, ou les deux : Niala choisit la meilleure façon de créer l&apos;exercice.</p>

      {!setup.aiConfigured && <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Le service d&apos;IA n&apos;est pas configuré : la génération d&apos;exercices est indisponible.</p>}

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <section aria-labelledby="ex-request" className={CARD}>
            <Label htmlFor="ex-request" id="ex-request" className="text-base font-semibold">Que voulez-vous travailler ?{sources.length > 0 && <span className="ml-1 font-normal text-muted-foreground">(facultatif)</span>}</Label>
            <p className="typo-meta mt-0.5">{sources.length > 0 ? "Précisez un chapitre, une notion ou un angle : les questions s'y concentreront." : "Matière, chapitre, notion… Aucun document n'est nécessaire."}</p>
            <Textarea id="ex-request" rows={3} maxLength={300} value={request} onChange={(e) => setRequest(e.target.value)} className="mt-3" placeholder="Ex. : Bases de données, jointures et sous-requêtes" />
          </section>

          <SourcesPicker subjectId={subjectId} sources={sources} onChange={setSources} />

          {sources.length > 0 && (
            <fieldset className={CARD}>
              <legend className="sr-only">Utilisation du document</legend>
              <h2 className="font-semibold">Que faire {sources.length > 1 ? "de ces documents" : "de ce document"} ?</h2>
              <div role="radiogroup" className="mt-3 grid gap-2 sm:grid-cols-2">
                {([
                  [true, "Reproduire ses exercices", sources.length > 1 ? "TD, devoirs, examens : leurs exercices sont réunis dans un seul exercice, repris tels quels." : "TD, devoir, examen : consignes et questions reprises telles quelles pour être résolues ici.", Repeat2],
                  [false, "Créer de nouvelles questions", sources.length > 1 ? "Les documents servent de cours : l'IA en tire des questions inédites, réparties sur tous." : "Le document sert de cours : l'IA en tire des questions inédites.", Sparkles],
                ] as const).map(([value, title, text, Icon]) => (
                  <label key={title} className={cn("flex cursor-pointer items-start gap-3 rounded-2xl border p-3 text-sm transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", reproduce === value && "border-primary bg-primary/5")}>
                    <input type="radio" name="document-use" className="sr-only" checked={reproduce === value} onChange={() => setReproduce(value)} />
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span><span className="block font-medium">{title}{value === detectedSheet && <span className="typo-meta ml-1.5 rounded-full bg-muted px-1.5 py-0.5">détecté</span>}</span><span className="typo-meta">{text}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {sourceMode !== "import" && <fieldset className={CARD}>
            <legend className="sr-only">Types de questions</legend>
            <h2 className="font-semibold">Types de questions</h2>
            <p className="typo-meta mt-0.5">Seuls les types cochés seront utilisés.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {QUESTION_TYPES.map((t) => (
                <label key={t} className={cn("flex cursor-pointer items-start gap-2 rounded-2xl border px-3 py-2 text-sm transition-colors", types.has(t) && "border-primary bg-primary/5")}>
                  <Checkbox checked={types.has(t)} onCheckedChange={(c) => setTypes(toggle(types, t, c === true))} className="mt-0.5" />
                  <span>{TYPE_LABEL[t]}{HINT[t] && <span className="typo-meta block">{HINT[t]}</span>}</span>
                </label>
              ))}
            </div>
          </fieldset>}

          {sourceMode === "course" && <fieldset className={CARD}>
            <legend className="sr-only">Couverture du cours</legend>
            <h2 className="font-semibold">Couverture du cours</h2>
            <div className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {([
                ["all", "Tout le contenu", true],
                ["sections", "Certaines sections", hasAnalysis && (opts?.sections.length ?? 0) > 0],
                ["concepts", "Certaines notions", hasAnalysis && (opts?.concepts.length ?? 0) > 0],
                ["hard", "Les notions difficiles ou principales", hasAnalysis && (opts?.concepts.length ?? 0) > 0],
              ] as [Coverage, string, boolean][]).map(([v, label, ok]) => (
                <label key={v} className={cn("flex items-center gap-2 text-sm", !ok && "opacity-50")}>
                  <input type="radio" name="coverage" checked={effectiveCoverage === v} disabled={!ok} onChange={() => setCoverage(v)} />
                  {label}
                  {!ok && <span className="typo-meta">— {coverageReason}</span>}
                </label>
              ))}
            </div>
            {effectiveCoverage === "sections" && opts && (
              <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-2xl border p-2" aria-label="Sections">
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
            {effectiveCoverage === "concepts" && opts && (
              <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-2xl border p-2" aria-label="Notions">
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
            {effectiveCoverage === "hard" && <p className="typo-meta mt-2">Notions que vous maîtrisez le moins ; à défaut d&apos;historique, notions principales du cours.</p>}
          </fieldset>}
        </div>

        <aside aria-label="Réglages de l'exercice" className={cn(CARD, "space-y-4 lg:sticky lg:top-4")}>
          <div className="space-y-1.5">
            <Label htmlFor="ex-title">Titre (facultatif)</Label>
            <Input id="ex-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder={sourceMode === "free" ? "Titre automatique" : sources[0] ? `Exercice — ${sources[0].name}` : "Titre automatique"} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ex-mode">Mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as ExerciseMode)}>
              <SelectTrigger id="ex-mode" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{EXERCISE_MODES.map((m) => <SelectItem key={m} value={m}>{MODE_META[m].label}</SelectItem>)}</SelectContent>
            </Select>
            <p className="typo-meta">{MODE_META[mode].text}</p>
          </div>

          {sourceMode !== "import" && <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ex-count">Questions</Label>
              <Input id="ex-count" type="number" min={1} max={setup.maxQuestions} value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Difficulté</Label>
              <Select value={difficulty} onValueChange={(v) => setDifficulty(v as typeof difficulty)}>
                <SelectTrigger aria-label="Difficulté" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{DIFFICULTY_LABEL[d]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <p className="typo-meta -mt-2">Maximum {setup.maxQuestions}.{sourceMode === "course" ? " Si les documents manquent de matière, l'exercice contiendra moins de questions." : ""}</p>
          </>}

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Barème</legend>
            <div className="flex flex-wrap gap-1.5">
              {(["10", "20", "100", "custom"] as Scale[]).map((s) => (
                <label key={s} className={cn("flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm", scale === s && "border-primary bg-primary/5")}>
                  <input type="radio" name="scale" className="sr-only" checked={scale === s} onChange={() => setScale(s)} />
                  {s === "custom" ? "Autre" : `Sur ${s}`}
                </label>
              ))}
              {scale === "custom" && <Input aria-label="Barème personnalisé (maximum 100)" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-9 w-20" />}
            </div>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Correction</legend>
            <div className="grid grid-cols-2 gap-2">
              {CORRECTION_MODES.map((m) => {
                const meta = CORRECTION_LABEL[m];
                return (
                  <label key={m} className={cn("flex cursor-pointer flex-col gap-1 rounded-2xl border p-3 text-sm transition-colors", effectiveCorrection === m && "border-primary bg-primary/5", correctionLocked && "cursor-not-allowed opacity-60")}>
                    <input type="radio" name="correction" className="sr-only" checked={effectiveCorrection === m} disabled={correctionLocked} onChange={() => setCorrectionMode(m)} />
                    <span className="flex items-center gap-1.5 font-medium"><meta.icon className="h-3.5 w-3.5" aria-hidden /> {meta.title}{effectiveCorrection === m && <CheckCircle2 className="ml-auto h-3.5 w-3.5" aria-hidden />}</span>
                    <span className="typo-meta">{meta.text}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {sourceMode !== "import" && showGauge && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <Label>Théorie et pratique</Label>
                <span className="tnum text-xs font-medium">{100 - practicePercent} % théorie · {practicePercent} % pratique</span>
              </div>
              <Slider min={0} max={100} step={10} value={[practicePercent]} disabled={!hasTheory} onValueChange={([v]) => setPractice(v)} aria-label="Part de pratique en pourcentage" />
              <p className="typo-meta">{hasTheory ? (Number.isInteger(n) && n > 0 ? `Environ ${n - practiceCount} question(s) de théorie et ${practiceCount} de pratique.` : "") : "Cochez un type théorique (QCM, définition…) pour répartir l'exercice."}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-2xl bg-muted/50 p-3">
            <div className="min-w-0">
              <Label htmlFor="ex-keep" className="text-sm font-medium">Conserver dans Mes exercices</Label>
              <p className="typo-meta mt-0.5">{keep ? "Vous le retrouverez avec ses corrections." : "Exercice ponctuel : retiré après 24 h."}</p>
            </div>
            <Switch id="ex-keep" checked={keep} onCheckedChange={setKeep} />
          </div>

          <div className="border-t pt-3">
            {problems.length > 0 && <ul role="alert" className="mb-2 text-sm text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            {submitError && <p role="alert" className="mb-2 text-sm font-medium text-destructive">{submitError}</p>}
            <p className="typo-meta mb-2">{sourceMode === "import" ? (Number.isFinite(total) ? `Barème total : ${fmtPoints(total)} points` : "") : Number.isFinite(total) && n ? `${n} question(s) · ${fmtPoints(total)} points${per ? ` · ≈ ${fmtPoints(Math.round(per * 100) / 100)} pt/question` : ""}` : ""}</p>
            <Button type="submit" disabled={busy || !setup.aiConfigured || problems.length > 0} className="w-full gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {busy ? (sourceMode === "import" ? "Lecture du sujet…" : "Génération en cours…") : sourceMode === "import" ? "Reproduire les exercices" : "Générer l'exercice"}
            </Button>
          </div>
        </aside>
      </div>
    </form>
  );
}
