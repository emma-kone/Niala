"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileQuestion, FileText, FolderOpen, Loader2, ListChecks, PenLine, Plus, Sparkles, Upload, X, Zap, type LucideIcon } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { CORRECTION_MODES, DIFFICULTIES, DIFFICULTY_LABEL, EXERCISE_MODES, MAX_SOURCE_DOCUMENTS, MODE_META, POINT_STEP, PROGRAMMING_TYPES, QUESTION_TYPES, TYPE_LABEL, type CorrectionMode, type ExerciseMode, type QuestionType } from "@/server/domain/exercise-types";
import { LEVEL_CHOICES, OTHER_LEVEL, isLevelChoice, levelText } from "@/config/academic";
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
  workspace: "Ouvre un atelier adapté : Merise (MCD, MLD…), mathématiques (formules, graphiques) ou algorithmique.",
};
const CORRECTION_LABEL: Record<CorrectionMode, { title: string; text: string; icon: typeof Zap }> = {
  immediate: { title: "En temps réel", text: "L'explication s'affiche après chaque réponse.", icon: Zap },
  final: { title: "À la fin", text: "Vous validez tout, puis l'IA détaille la correction.", icon: ListChecks },
};
const ACCEPTED_FILES = ".pdf,.docx,.pptx,.txt,.md";
type SourceMode = "free" | "course" | "import";
const SOURCE_MODES: { value: SourceMode; title: string; text: string; icon: LucideIcon }[] = [
  { value: "free", title: "Génération libre", text: "Une matière et un thème suffisent.", icon: PenLine },
  { value: "course", title: "Depuis un cours", text: "L'IA crée des questions à partir de votre document.", icon: FileText },
  { value: "import", title: "Reproduire un sujet", text: "Vos exercices (TD, examen) deviennent interactifs.", icon: FileQuestion },
];
const CARD = "rounded-3xl border bg-card p-5";

const sourceOf = (o: ExerciseOptions): Source => ({ id: o.document.id, name: o.document.name, ready: o.document.ready });
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
    const room = MAX_SOURCE_DOCUMENTS - sources.length;
    const accepted = files.slice(0, room);
    setError(files.length > room ? `${MAX_SOURCE_DOCUMENTS} documents maximum : les fichiers en trop n'ont pas été importés.` : null);
    const items = accepted.map((f, i): UploadItem => ({ key: `${f.name}-${i}-${Date.now()}`, name: f.name, phase: "waiting" }));
    setUploads((u) => [...u, ...items]);
    const finished = new Map<string, UploadItem>(items.map((i) => [i.key, i]));
    await uploadFiles(accepted, { subjectId, folderId: null }, (key, patch) => {
      finished.set(key, { ...finished.get(key)!, ...patch });
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    }, items.map((i) => i.key));
    for (const item of finished.values()) {
      if (item.phase !== "done" || !item.documentId) continue;
      await add(item.documentId);
      setUploads((u) => u.filter((x) => x.key !== item.key));
    }
  }

  const selected = new Set(sources.map((s) => s.id));
  const sending = uploads.some((u) => u.phase === "waiting" || u.phase === "sending" || u.phase === "processing");

  return (
    <section aria-labelledby="ex-sources" className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="ex-sources" className="font-semibold">Documents sources</h2>
          <p className="typo-meta mt-0.5">Les questions ne s&apos;appuient que sur ces documents ({sources.length} / {MAX_SOURCE_DOCUMENTS}).</p>
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
          <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-full" disabled={full || sending} onClick={() => input.current?.click()}><Upload className="h-3.5 w-3.5" aria-hidden /> Importer un fichier</Button>
        </div>
      </div>
      {sources.length === 0 && uploads.length === 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground"><Plus className="h-4 w-4 shrink-0" aria-hidden /> Importez un fichier (PDF, DOCX, PPTX, TXT, MD){subjects.length > 0 ? ", ou choisissez un document dans vos matières" : ""}.</p>
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

/** Sujet à reproduire : un seul fichier, déposé et lu avant la mise en forme interactive. */
function ImportPicker({ source, phase, onFile, onClear }: { source: Source | null; phase: UploadItem | null; onFile: (f: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const sending = phase && (phase.phase === "waiting" || phase.phase === "sending" || phase.phase === "processing");
  return (
    <section aria-labelledby="ex-import" className={CARD}>
      <h2 id="ex-import" className="font-semibold">Document contenant les exercices</h2>
      <p className="typo-meta mt-0.5">TD, devoir ou sujet d&apos;examen : les exercices, consignes et sous-questions sont repris tels quels pour être résolus ici.</p>
      <input ref={input} type="file" accept={ACCEPTED_FILES} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      {source ? (
        <p className="mt-3 flex items-center gap-2 rounded-2xl bg-muted/50 py-2 pl-3 pr-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 truncate font-medium">{source.name}</span>
          <button type="button" aria-label={`Retirer ${source.name}`} className="rounded-full p-1 text-muted-foreground hover:bg-background hover:text-foreground" onClick={onClear}><X className="h-3.5 w-3.5" aria-hidden /></button>
        </p>
      ) : (
        <button type="button" disabled={!!sending} onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }} className="mt-3 flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-10 text-sm text-muted-foreground transition-colors hover:bg-muted/40">
          {sending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Upload className="h-5 w-5" aria-hidden />}
          {sending ? "Import et lecture du fichier…" : "Déposez un fichier ou cliquez pour le choisir"}
          <span className="typo-meta">PDF, DOCX, PPTX, TXT ou MD</span>
        </button>
      )}
      {phase?.phase === "error" && <p role="alert" className="mt-2 text-sm text-destructive">{phase.message ?? "Import impossible."}</p>}
    </section>
  );
}

export default function CreateExerciseView({ subjectId, documentId, presetConcepts = [], initialSource, preset }: { subjectId: string | null; documentId: string | null; presetConcepts?: string[]; initialSource?: string | null; preset?: { subject?: string | null; chapter?: string | null; difficulty?: string | null; count?: string | null; mode?: string | null } }) {
  const router = useRouter();
  const { settings } = useSettings();
  const { data: profile } = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchProfile });
  // Depuis une matière ou un document, la source est déjà connue : le choix n'est proposé que depuis le module Exercices.
  const standalone = !subjectId && !documentId;
  const [sourceMode, setSourceMode] = useState<SourceMode>(() => (!standalone ? "course" : initialSource === "course" || initialSource === "import" ? initialSource : "free"));
  const [freeSubject, setFreeSubject] = useState(preset?.subject?.slice(0, 120) ?? "");
  const [chapter, setChapter] = useState(preset?.chapter?.slice(0, 200) ?? "");
  // Tant que l'étudiant n'a rien choisi pour cet exercice, ses préférences et son profil font office de valeurs proposées.
  const [levelChoice, setLevel] = useState("");
  const level = levelChoice || (isLevelChoice(profile?.level) ? profile.level : "");
  const [levelOtherChoice, setLevelOther] = useState<string | null>(null);
  const levelOther = levelOtherChoice ?? (level === profile?.level ? (profile?.levelOther ?? "") : "");
  const [modeChoice, setMode] = useState<ExerciseMode | null>((EXERCISE_MODES as readonly string[]).includes(preset?.mode ?? "") ? (preset!.mode as ExerciseMode) : null);
  const mode = modeChoice ?? settings?.defaultMode ?? "personnalise";
  const [keep, setKeep] = useState(true);
  const [importSource, setImportSource] = useState<Source | null>(null);
  const [importPhase, setImportPhase] = useState<UploadItem | null>(null);
  const [setup, setSetup] = useState<{ aiConfigured: boolean; maxQuestions: number } | null>(null);
  const [opts, setOpts] = useState<ExerciseOptions | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  const [title, setTitle] = useState("");
  const [count, setCount] = useState(/^\d{1,3}$/.test(preset?.count ?? "") ? preset!.count! : "10");
  const [scale, setScale] = useState<Scale>("20");
  const [custom, setCustom] = useState("15");
  const [types, setTypes] = useState<Set<QuestionType>>(new Set(["qcm_single", "true_false", "short_answer"]));
  const [coverageChoice, setCoverage] = useState<Coverage | null>(null);
  const coverage: Coverage = coverageChoice ?? (mode === "revision" ? "hard" : "all");
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set());
  const [conceptIds, setConceptIds] = useState<Set<string>>(new Set());
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>((DIFFICULTIES as readonly string[]).includes(preset?.difficulty ?? "") ? (preset!.difficulty as (typeof DIFFICULTIES)[number]) : "progressive");
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

  // « Révision ciblée » demande les notions fragiles, qui supposent un document déjà analysé.
  const effectiveCoverage: Coverage = singleId && (coverage !== "hard" || (opts?.concepts.length ?? 0) > 0) ? coverage : "all";
  const correctionLocked = mode === "examen";
  const effectiveCorrection: CorrectionMode = correctionLocked ? "final" : correctionMode;
  const total = scale === "custom" ? Number(custom.replace(",", ".")) : Number(scale);
  const n = Number(count);
  const showGauge = PROGRAMMING_TYPES.some((t) => types.has(t));
  const hasTheory = [...types].some((t) => t !== "code" && t !== "sql" && t !== "practical" && t !== "workspace");
  const practicePercent = hasTheory ? practice : 100;
  const practiceCount = Number.isInteger(n) && n > 0 ? Math.round((n * practicePercent) / 100) : 0;

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!setup) return p;
    if (sourceMode === "free") {
      if (freeSubject.trim().length < 2) p.push("Indiquez la matière.");
      if (chapter.trim().length < 2) p.push("Indiquez le chapitre ou le thème.");
      if (!level) p.push("Choisissez le niveau d'études.");
      else if (level === OTHER_LEVEL && levelOther.trim().length < 2) p.push("Précisez le niveau d'études.");
    }
    if (sourceMode === "course") {
      if (sources.length === 0) p.push("Ajoutez au moins un document.");
      if (sources.some((s) => !s.ready)) p.push("Retirez les documents dont le texte n'a pas pu être extrait.");
    }
    if (sourceMode === "import") {
      if (!importSource) p.push("Importez le document contenant les exercices.");
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
  }, [setup, sources, n, total, types, effectiveCoverage, sectionIds, conceptIds, sourceMode, freeSubject, chapter, level, levelOther, importSource]);

  async function importFile(file: File) {
    const item: UploadItem = { key: `${file.name}-${Date.now()}`, name: file.name, phase: "waiting" };
    setImportPhase(item);
    let latest = item;
    await uploadFiles([file], { subjectId, folderId: null }, (_key, patch) => {
      latest = { ...latest, ...patch };
      setImportPhase(latest);
    }, [item.key]);
    if (latest.phase === "done" && latest.documentId) {
      setImportSource({ id: latest.documentId, name: file.name, ready: true });
      setImportPhase(null);
    }
  }

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
          ? await api.post<{ id: string; subjectId: string | null }>("/api/exercises/import", { ...common, documentId: importSource!.id })
          : sourceMode === "free"
            ? await api.post<{ id: string; subjectId: string | null }>("/api/exercises", { ...generation, source: "free", subject: freeSubject.trim(), chapter: chapter.trim(), level, levelOther: levelOther.trim() || undefined })
            : await api.post<{ id: string; subjectId: string | null }>("/api/exercises", {
                ...generation,
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
      <p className="typo-subtitle mt-1">{sourceMode === "free" ? "Indiquez ce que vous voulez travailler : aucun document n'est nécessaire." : sourceMode === "import" ? "Résolvez vos propres sujets directement dans Niala, avec l'aide du tuteur." : "Choisissez vos sources et réglez l'exercice : rien n'est inventé en dehors de vos documents."}</p>

      {standalone && (
        <div role="radiogroup" aria-label="Point de départ de l'exercice" className="mt-5 grid gap-2 sm:grid-cols-3">
          {SOURCE_MODES.map((s) => (
            <label key={s.value} className={cn("flex cursor-pointer items-start gap-3 rounded-3xl border bg-card p-4 transition-colors hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", sourceMode === s.value && "border-primary bg-primary/5")}>
              <input type="radio" name="source-mode" className="sr-only" checked={sourceMode === s.value} onChange={() => setSourceMode(s.value)} />
              <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span><span className="block font-semibold">{s.title}</span><span className="typo-meta">{s.text}</span></span>
            </label>
          ))}
        </div>
      )}

      {!setup.aiConfigured && <p role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Le service d&apos;IA n&apos;est pas configuré : la génération d&apos;exercices est indisponible.</p>}

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {sourceMode === "free" && (
            <section aria-labelledby="ex-topic" className={cn(CARD, "space-y-4")}>
              <h2 id="ex-topic" className="font-semibold">Sujet de l&apos;exercice</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ex-subject">Matière <span className="text-destructive" aria-hidden>*</span></Label>
                  <Input id="ex-subject" required maxLength={120} value={freeSubject} onChange={(e) => setFreeSubject(e.target.value)} placeholder="Bases de données" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ex-level">Niveau d&apos;études <span className="text-destructive" aria-hidden>*</span></Label>
                  <Select value={level} onValueChange={setLevel}>
                    <SelectTrigger id="ex-level" className="w-full"><SelectValue placeholder="Choisir un niveau" /></SelectTrigger>
                    <SelectContent>{LEVEL_CHOICES.map((l) => <SelectItem key={l} value={l}>{l === OTHER_LEVEL ? "Autre" : levelText(l)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {level === OTHER_LEVEL && (
                <div className="space-y-1.5">
                  <Label htmlFor="ex-level-other">Précisez le niveau <span className="text-destructive" aria-hidden>*</span></Label>
                  <Input id="ex-level-other" required maxLength={80} value={levelOther} onChange={(e) => setLevelOther(e.target.value)} placeholder="Terminale, Doctorat, Formation continue…" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ex-chapter">Chapitre ou thème <span className="text-destructive" aria-hidden>*</span></Label>
                <Input id="ex-chapter" required maxLength={200} value={chapter} onChange={(e) => setChapter(e.target.value)} placeholder="Jointures et sous-requêtes" />
              </div>
            </section>
          )}
          {sourceMode === "course" && <SourcesPicker subjectId={subjectId} sources={sources} onChange={setSources} />}
          {sourceMode === "import" && <ImportPicker source={importSource} phase={importPhase} onFile={(f) => void importFile(f)} onClear={() => setImportSource(null)} />}

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
