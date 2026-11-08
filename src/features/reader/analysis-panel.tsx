"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  ChevronDown,
  ChevronRight,
  GitFork,
  Indent,
  Loader2,
  MoreVertical,
  Network,
  Outdent,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NameDialog } from "@/features/subject-files/dialogs";
import { routes } from "@/config/routes";
import { confirmAction } from "@/components/notifications";

type Origin = "DOCUMENT" | "AI_INFERRED" | "USER";
interface Section {
  id: string;
  parentId: string | null;
  label: string;
  numbering: string | null;
  level: number;
  position: number;
  pageStart: number | null;
  pageEnd: number | null;
  origin: Origin;
  edited: boolean;
}
interface ConceptItem {
  id: string;
  conceptId: string;
  sectionId: string | null;
  name: string;
  kind: "NOTION" | "DEFINITION" | "PROPERTY" | "RULE" | "EXAMPLE";
  importance: number;
  definition: string | null;
  origin: Origin;
  refs: { page: number | null; quote: string }[];
}
interface AnalysisResponse {
  aiConfigured: boolean;
  history: { id: string; versionNumber: number; status: string; model: string | null; createdAt: string }[];
  analysis: { id: string; status: "PENDING" | "RUNNING" | "READY" | "FAILED"; model: string | null; notice: string | null; createdAt: string; versionNumber: number; outdated: boolean } | null;
  sections: Section[];
  concepts: ConceptItem[];
  relations: { id: string; fromId: string; toId: string; type: string }[];
}

const KIND_LABEL: Record<ConceptItem["kind"], string> = { NOTION: "Notion", DEFINITION: "Définition", PROPERTY: "Propriété", RULE: "Règle", EXAMPLE: "Exemple" };
const ORIGIN: Record<Origin, { label: string; className: string; Icon: typeof Sparkles | null }> = {
  DOCUMENT: { label: "Dans le document", className: "text-emerald-700 dark:text-emerald-400", Icon: BookMarked },
  AI_INFERRED: { label: "Déduit par l'IA", className: "text-amber-700 dark:text-amber-400", Icon: Sparkles },
  USER: { label: "Ajouté ou corrigé par vous", className: "text-sky-700 dark:text-sky-400", Icon: User },
};
const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);

function OriginTag({ origin, className }: { origin: Origin; className?: string }) {
  const o = ORIGIN[origin];
  return (
    <span title={o.label} className={cn("inline-flex shrink-0 items-center gap-1 text-[10px] font-medium", o.className, className)}>
      {o.Icon && <o.Icon className="h-3 w-3" aria-hidden />}
      <span className="sr-only sm:not-sr-only">{o.label}</span>
    </span>
  );
}

export function AnalysisPanel({ docId, subjectId, onGoToPage }: { docId: string; subjectId: string; onGoToPage: (page: number) => void }) {
  const router = useRouter();
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expandedConcepts, setExpandedConcepts] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const seq = useRef(0);

  const [rename, setRename] = useState<Section | null>(null);
  const [adding, setAdding] = useState<{ parentId: string | null; afterId: string | null } | null>(null);
  const [conceptDialog, setConceptDialog] = useState<{ section: Section; concept: ConceptItem | null } | null>(null);

  const load = useCallback(
    async (analysisId?: string | null) => {
      const n = ++seq.current;
      try {
        const res = await api.get<AnalysisResponse>(`/api/files/${docId}/analysis${analysisId ? `?analysisId=${analysisId}` : ""}`);
        if (n !== seq.current) return;
        setData(res);
        setError(null);
      } catch (e) {
        if (n === seq.current) setError(errText(e, "Analyse indisponible."));
      }
    },
    [docId]
  );

  useEffect(() => {
    void load(selectedId);
  }, [load, selectedId]);

  // Une analyse peut tourner pendant plusieurs minutes : on suit son état
  const status = data?.analysis?.status;
  useEffect(() => {
    if (status !== "RUNNING" || running) return;
    const t = setTimeout(() => void load(selectedId), 4000);
    return () => clearTimeout(t);
  }, [status, running, data, load, selectedId]);

  async function start(force: boolean) {
    if (force && !(await confirmAction("Relancer l'analyse complète ? L'analyse actuelle est conservée dans l'historique, mais vos corrections ne sont pas reportées sur la nouvelle.", { confirmLabel: "Relancer", danger: false }))) return;
    setRunning(true);
    setActionError(null);
    try {
      const res = await api.post<AnalysisResponse & { analysisId: string }>(`/api/files/${docId}/analysis`, { force });
      setSelectedId(null);
      setData(res);
    } catch (e) {
      setActionError(errText(e, "L'analyse a échoué."));
      await load(selectedId);
    } finally {
      setRunning(false);
    }
  }

  async function generateMap(kind: "STRUCTURE" | "CONCEPT") {
    if (!data?.analysis) return;
    setBusy("map-" + kind);
    setActionError(null);
    try {
      const r = await api.post<{ id: string }>("/api/maps/generate", { analysisId: data.analysis.id, kind });
      router.push(`${routes.subject(subjectId)}/cartes/${r.id}`);
    } catch (e) {
      setActionError(errText(e, "Génération impossible."));
      setBusy(null);
    }
  }

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      await load(selectedId);
    } catch (e) {
      setActionError(errText(e, "Action impossible."));
    } finally {
      setBusy(null);
    }
  }

  // ── Arbre ──
  const tree = useMemo(() => {
    const byParent = new Map<string | null, Section[]>();
    for (const s of data?.sections ?? []) byParent.set(s.parentId, [...(byParent.get(s.parentId) ?? []), s]);
    for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);
    return byParent;
  }, [data?.sections]);
  const conceptsBySection = useMemo(() => {
    const m = new Map<string, ConceptItem[]>();
    for (const c of data?.concepts ?? []) if (c.sectionId) m.set(c.sectionId, [...(m.get(c.sectionId) ?? []), c]);
    return m;
  }, [data?.concepts]);

  if (error && !data) return <div className="p-4"><p role="alert" className="text-sm text-destructive">{error}</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void load(selectedId)}>Réessayer</Button></div>;
  if (!data) return <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…</p>;

  const a = data.analysis;
  const roots = tree.get(null) ?? [];
  const siblingsOf = (s: Section) => tree.get(s.parentId) ?? [];

  const renderNode = (s: Section, depth: number): React.ReactNode => {
    const kids = tree.get(s.id) ?? [];
    const concepts = conceptsBySection.get(s.id) ?? [];
    const open = !collapsed.has(s.id);
    const sibs = siblingsOf(s);
    const idx = sibs.findIndex((x) => x.id === s.id);
    const hasBody = kids.length > 0 || concepts.length > 0;
    return (
      <li key={s.id}>
        <div className="group flex items-start gap-1 rounded-md py-1 pr-1 hover:bg-muted/50" style={{ paddingLeft: depth * 14 }}>
          <button
            type="button"
            onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
            aria-expanded={hasBody ? open : undefined}
            aria-label={open ? "Réduire" : "Développer"}
            className={cn("mt-0.5 shrink-0 rounded p-0.5 hover:bg-muted", !hasBody && "invisible")}
          >
            {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              {s.numbering && <span className="shrink-0 text-xs font-semibold text-muted-foreground">{s.numbering}</span>}
              <span className={cn("text-sm", depth === 0 ? "font-semibold" : "font-medium")}>{s.label}</span>
              {s.pageStart && (
                <button type="button" onClick={() => onGoToPage(s.pageStart!)} className="text-[11px] text-primary hover:underline" aria-label={`Aller à la page ${s.pageStart}`}>
                  p. {s.pageStart}{s.pageEnd && s.pageEnd !== s.pageStart ? `–${s.pageEnd}` : ""}
                </button>
              )}
              {s.origin !== "DOCUMENT" && <OriginTag origin={s.origin} />}
              {s.edited && s.origin === "DOCUMENT" && <span className="text-[10px] text-sky-700 dark:text-sky-400">modifié</span>}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 opacity-60 group-hover:opacity-100" aria-label={`Actions pour ${s.label}`}>
                {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <MoreVertical className="h-3.5 w-3.5" aria-hidden />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRename(s)}><Pencil className="mr-2 h-4 w-4" aria-hidden /> Modifier le titre</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAdding({ parentId: s.id, afterId: null })}><Plus className="mr-2 h-4 w-4" aria-hidden /> Ajouter une sous-section</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAdding({ parentId: s.parentId, afterId: s.id })}><Plus className="mr-2 h-4 w-4" aria-hidden /> Ajouter une section après</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConceptDialog({ section: s, concept: null })}><BookMarked className="mr-2 h-4 w-4" aria-hidden /> Ajouter une notion</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={idx <= 0} onSelect={() => void act(s.id, () => api.post(`/api/analysis/sections/${s.id}/move`, { direction: "up" }))}><ArrowUp className="mr-2 h-4 w-4" aria-hidden /> Monter</DropdownMenuItem>
              <DropdownMenuItem disabled={idx >= sibs.length - 1} onSelect={() => void act(s.id, () => api.post(`/api/analysis/sections/${s.id}/move`, { direction: "down" }))}><ArrowDown className="mr-2 h-4 w-4" aria-hidden /> Descendre</DropdownMenuItem>
              <DropdownMenuItem disabled={idx <= 0} onSelect={() => void act(s.id, () => api.post(`/api/analysis/sections/${s.id}/move`, { direction: "indent" }))}><Indent className="mr-2 h-4 w-4" aria-hidden /> Placer sous la section précédente</DropdownMenuItem>
              <DropdownMenuItem disabled={!s.parentId} onSelect={() => void act(s.id, () => api.post(`/api/analysis/sections/${s.id}/move`, { direction: "outdent" }))}><Outdent className="mr-2 h-4 w-4" aria-hidden /> Remonter d&apos;un niveau</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!data.aiConfigured} onSelect={() => void act(s.id, () => api.post(`/api/analysis/sections/${s.id}/reanalyze`))}><RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Relancer l&apos;analyse de cette partie</DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => {
                  const n = (tree.get(s.id) ?? []).length;
                  void confirmAction(`Supprimer « ${s.label} »${n ? ` et ses ${n} sous-section(s)` : ""}, avec leurs notions ?`, { confirmLabel: "Supprimer" }).then((ok) => { if (ok) void act(s.id, () => api.del(`/api/analysis/sections/${s.id}`)); });
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {open && concepts.length > 0 && (
          <ul className="mb-1 space-y-1" style={{ paddingLeft: depth * 14 + 26 }}>
            {concepts.map((c) => {
              const expanded = expandedConcepts.has(c.id);
              return (
                <li key={c.id} className="rounded-md border bg-card px-2 py-1.5 text-xs">
                  <div className="flex items-start gap-1.5">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setExpandedConcepts((e) => { const n = new Set(e); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} aria-expanded={expanded}>
                      <span className="font-semibold">{c.name}</span>{" "}
                      <span className="text-muted-foreground">· {KIND_LABEL[c.kind]}</span>
                    </button>
                    <OriginTag origin={c.origin} />
                    <button type="button" aria-label={`Modifier ${c.name}`} className="rounded p-0.5 hover:bg-muted" onClick={() => setConceptDialog({ section: s, concept: c })}><Pencil className="h-3 w-3" aria-hidden /></button>
                    <button type="button" aria-label={`Supprimer ${c.name}`} className="rounded p-0.5 text-destructive hover:bg-muted" onClick={() => { void confirmAction(`Supprimer la notion « ${c.name} » ?`, { confirmLabel: "Supprimer" }).then((ok) => { if (ok) void act(c.id, () => api.del(`/api/analysis/concepts/${c.id}`)); }); }}><Trash2 className="h-3 w-3" aria-hidden /></button>
                  </div>
                  {(expanded || c.definition) && c.definition && <p className="mt-1 text-muted-foreground">{c.definition}</p>}
                  {expanded && c.refs.map((r, i) => (
                    <p key={i} className="mt-1 border-l-2 border-emerald-500 pl-2 italic text-muted-foreground">
                      « {r.quote} » {r.page && <button type="button" className="not-italic text-primary hover:underline" onClick={() => onGoToPage(r.page!)}>p. {r.page}</button>}
                    </p>
                  ))}
                  {expanded && c.refs.length === 0 && c.origin === "AI_INFERRED" && <p className="mt-1 text-amber-700 dark:text-amber-400">Cette notion est une déduction : elle n&apos;est pas citée mot pour mot dans le document.</p>}
                </li>
              );
            })}
          </ul>
        )}
        {open && kids.length > 0 && <ul>{kids.map((k) => renderNode(k, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b p-3">
        {!data.aiConfigured && (
          <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Le service d&apos;IA n&apos;est pas configuré (variable <code>GEMINI_API_KEY</code>). Le plan est détecté à partir de la numérotation du document ; les notions ne peuvent pas être extraites.
          </p>
        )}
        <div className="flex items-center gap-2">
          {!a ? (
            <Button className="w-full gap-2" onClick={() => void start(false)} disabled={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
              {running ? "Analyse en cours…" : "Analyser ce document"}
            </Button>
          ) : (
            <>
              <Select value={a.id} onValueChange={(v) => setSelectedId(v)}>
                <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Analyse affichée"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.history.map((h, i) => (
                    <SelectItem key={h.id} value={h.id}>
                      {i === 0 ? "Dernière · " : ""}{new Date(h.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })} · v{h.versionNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void start(true)} disabled={running}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Relancer
              </Button>
            </>
          )}
        </div>
        {a?.status === "RUNNING" && <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Analyse en cours : cela peut prendre quelques minutes.</p>}
        {a?.status === "FAILED" && <p role="alert" className="text-xs text-destructive">{a.notice ?? "L'analyse a échoué."}</p>}
        {a?.status === "READY" && a.notice && <p role="note" className="text-xs text-muted-foreground">{a.notice}</p>}
        {a?.outdated && <p role="note" className="rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Cette analyse concerne une version antérieure du document.</p>}
        {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
        {a?.status === "READY" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={roots.length === 0 || busy !== null} onClick={() => void generateMap("STRUCTURE")}>
              {busy === "map-STRUCTURE" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <GitFork className="h-4 w-4" aria-hidden />} Carte de structure
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={data.concepts.length === 0 || busy !== null} onClick={() => void generateMap("CONCEPT")} title={data.concepts.length === 0 ? "Aucune notion : elles sont extraites par le service d'IA" : undefined}>
              {busy === "map-CONCEPT" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Network className="h-4 w-4" aria-hidden />} Carte conceptuelle
            </Button>
            <Link href={`${routes.subject(subjectId)}/cartes`} className="self-center text-xs text-primary hover:underline">Toutes les cartes</Link>
          </div>
        )}
        {a?.status === "READY" && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]" aria-label="Légende">
            {(Object.keys(ORIGIN) as Origin[]).map((o) => <OriginTag key={o} origin={o} />)}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {a?.status === "READY" && roots.length === 0 && (
          <div className="p-3 text-sm">
            <p className="text-muted-foreground">Aucun plan n&apos;a été détecté. Vous pouvez en créer un à la main.</p>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => setAdding({ parentId: null, afterId: null })}><Plus className="h-4 w-4" aria-hidden /> Ajouter une section</Button>
          </div>
        )}
        {roots.length > 0 && <ul aria-label="Plan du document">{roots.map((r) => renderNode(r, 0))}</ul>}
        {roots.length > 0 && a && (
          <Button size="sm" variant="ghost" className="mt-2 gap-1.5 text-xs" onClick={() => setAdding({ parentId: null, afterId: roots.at(-1)!.id })}><Plus className="h-3.5 w-3.5" aria-hidden /> Ajouter une section</Button>
        )}
      </div>

      <NameDialog
        open={!!rename}
        title="Modifier le titre"
        initial={rename?.label ?? ""}
        submitLabel="Enregistrer"
        onClose={() => setRename(null)}
        onSubmit={async (label) => {
          await api.patch(`/api/analysis/sections/${rename!.id}`, { label });
          setRename(null);
          await load(selectedId);
        }}
      />
      <NameDialog
        open={!!adding}
        title="Nouvelle section"
        description="Elle sera marquée « ajoutée par vous »."
        initial=""
        submitLabel="Ajouter"
        onClose={() => setAdding(null)}
        onSubmit={async (label) => {
          await api.post(`/api/analysis/${a!.id}/sections`, { parentId: adding!.parentId, afterId: adding!.afterId, label });
          setAdding(null);
          await load(selectedId);
        }}
      />
      <ConceptDialog
        state={conceptDialog}
        onClose={() => setConceptDialog(null)}
        onSubmit={async (v) => {
          const st = conceptDialog!;
          if (st.concept) await api.patch(`/api/analysis/concepts/${st.concept.id}`, { name: v.name, definition: v.definition || null, importance: v.importance });
          else await api.post(`/api/analysis/sections/${st.section.id}/concepts`, { name: v.name, kind: v.kind, definition: v.definition || undefined });
          setConceptDialog(null);
          await load(selectedId);
        }}
      />
    </div>
  );
}

function ConceptDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: { section: Section; concept: ConceptItem | null } | null;
  onClose: () => void;
  onSubmit: (v: { name: string; kind: ConceptItem["kind"]; definition: string; importance: number }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ConceptItem["kind"]>("NOTION");
  const [definition, setDefinition] = useState("");
  const [importance, setImportance] = useState("2");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state) {
      setName(state.concept?.name ?? "");
      setKind(state.concept?.kind ?? "NOTION");
      setDefinition(state.concept?.definition ?? "");
      setImportance(String(state.concept?.importance ?? 2));
      setError(null);
    }
  }, [state]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Le nom est requis.");
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name, kind, definition, importance: Number(importance) });
    } catch (err) {
      setError(errText(err, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader><DialogTitle>{state?.concept ? "Corriger la notion" : "Ajouter une notion"}</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="c-name">Nom</Label><Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus /></div>
          {!state?.concept && (
            <div className="space-y-1.5">
              <Label>Nature</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as ConceptItem["kind"])}>
                <SelectTrigger aria-label="Nature"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(KIND_LABEL) as ConceptItem["kind"][]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {state?.concept && (
            <div className="space-y-1.5">
              <Label>Importance</Label>
              <Select value={importance} onValueChange={setImportance}>
                <SelectTrigger aria-label="Importance"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">Secondaire</SelectItem><SelectItem value="2">Normale</SelectItem><SelectItem value="3">Principale</SelectItem></SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5"><Label htmlFor="c-def">Définition (facultatif)</Label><Textarea id="c-def" value={definition} onChange={(e) => setDefinition(e.target.value)} maxLength={600} rows={3} /></div>
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={busy}>{busy ? "…" : "Enregistrer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
