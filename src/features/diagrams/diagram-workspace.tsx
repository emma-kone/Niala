"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, CircleDot, Download, FileUp, Loader2, Maximize, Maximize2, Minimize2, MousePointer2, PanelRightClose, PanelRightOpen, Redo2, Spline, Square, StickyNote, Table2, Trash2, Undo2, ZoomIn, ZoomOut, Box } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { DIAGRAM_KINDS, diagramWarnings, mcdToMld, parseDiagram, type Diagram, type DiagramKind, type DiagramLink, type DiagramNode } from "@/server/domain/diagram";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { confirmAction } from "@/components/notifications";
import { DiagramWorkspaceSkeleton } from "./diagram-skeletons";
import type { LabWorkspaceDto } from "@/features/labs/types";
import { DiagramCanvas, type CanvasHandle, type Tool, type View } from "./diagram-canvas";
import { Inspector } from "./inspector";
import { DiagramAssistant } from "./diagram-assistant";
import { bounds, newId, nodeSize, type Point } from "./geometry";
import { diagramChatKey, diagramUiKey, LAST_DIAGRAM_KEY } from "./storage-keys";

// Espace de travail du laboratoire de diagrammes : canevas d'édition (MCD ou UML), panneau latéral repliable
// (assistant IA, propriétés, sujet de l'exercice importé ou collé, vérifications et MLD), plein écran de la grille.
// L'état de l'écran (cadrage, onglet, panneau, sélection, modifications non enregistrées) est gardé : en revenant
// au module après en avoir visité un autre, l'étudiant retrouve son diagramme tel qu'il l'a laissé.

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const HISTORY_MAX = 80;
const uiKey = diagramUiKey;

interface UiState {
  view?: View;
  panel?: boolean;
  tab?: string;
  full?: boolean;
  inspect?: string | null;
  selection?: string[];
  /** Modifications de propriétés pas encore enregistrées. */
  draft?: Diagram | null;
}

function readUi(id: string): UiState {
  try {
    return JSON.parse(localStorage.getItem(uiKey(id)) ?? "{}") as UiState;
  } catch {
    return {};
  }
}

/** Noms vides (en cours de frappe) remplacés avant l'enregistrement : le diagramme enregistré est toujours valide. */
function clean(d: Diagram): Diagram {
  return {
    ...d,
    nodes: d.nodes.map((n) => ({ ...n, name: n.name.trim() || (n.type === "note" ? "Note" : n.type.toUpperCase()), attributes: n.attributes.map((a) => ({ ...a, name: a.name.trim() || "attribut" })).filter((a) => a.name), methods: n.methods.map((m) => m.trim()).filter(Boolean) })),
  };
}

export default function DiagramWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const canvas = useRef<CanvasHandle>(null);
  const [ui] = useState(() => readUi(id));
  const [ws, setWs] = useState<LabWorkspaceDto | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const [past, setPast] = useState<Diagram[]>([]);
  const [future, setFuture] = useState<Diagram[]>([]);
  const [selection, setSelection] = useState<string[]>(ui.selection ?? []);
  const [inspect, setInspect] = useState<string | null>(ui.inspect ?? null);
  const [draft, setDraft] = useState<Diagram | null>(ui.draft ?? null);
  const [panel, setPanel] = useState(ui.panel ?? true);
  const [full, setFull] = useState(ui.full ?? false);
  const [tool, setTool] = useState<Tool>("select");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statement, setStatement] = useState("");
  const [subjectSaved, setSubjectSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [importing, setImporting] = useState(false);
  const [subjectError, setSubjectError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [tab, setTab] = useState(ui.tab ?? "assistant");
  const dirty = useRef(false);
  const subjectDirty = useRef(false);
  const diagramRef = useRef<Diagram | null>(null);
  diagramRef.current = diagram;
  const draftRef = useRef<Diagram | null>(draft);
  draftRef.current = draft;
  const viewRef = useRef<View | undefined>(ui.view);
  const selectionRef = useRef<string[]>([]);
  selectionRef.current = selection;

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ workspace: LabWorkspaceDto }>(`/api/labs/${id}`);
      if (r.workspace.kind !== "DIAGRAM") {
        router.replace(`${r.workspace.kind === "SQL" ? routes.sql : routes.code}/${id}`);
        return;
      }
      setWs(r.workspace);
      setTitle(r.workspace.title);
      localStorage.setItem(LAST_DIAGRAM_KEY, id);
      const f = r.workspace.files[0];
      if (!dirty.current) setDiagram(parseDiagram(f?.content ?? "", (f?.language as DiagramKind) ?? "mcd"));
      if (!subjectDirty.current) setStatement(r.workspace.brief?.statement ?? "");
      setError(null);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 404 && localStorage.getItem(LAST_DIAGRAM_KEY) === id) localStorage.removeItem(LAST_DIAGRAM_KEY);
      setError({ message: errText(e, "Chargement impossible."), status });
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Cadre le diagramme au premier affichage.
  const fitted = useRef(false);
  useEffect(() => {
    if (diagram && !fitted.current) {
      fitted.current = true;
      if (!ui.view) requestAnimationFrame(() => canvas.current?.fit());
    }
  }, [diagram, ui.view]);

  // ── Modifications avec historique (Ctrl+Z / Ctrl+Y) ──
  /** Diagramme affiché : l'enregistré, plus les propriétés modifiées pas encore enregistrées. */
  const current = useCallback(() => draftRef.current ?? diagramRef.current, []);
  const change = useCallback((next: Diagram, record = true) => {
    const cur = diagramRef.current;
    draftRef.current = null;
    setDraft(null);
    if (cur && record) {
      setPast((p) => [...p.slice(-HISTORY_MAX + 1), cur]);
      setFuture([]);
    }
    diagramRef.current = next;
    setDiagram(next);
    dirty.current = true;
    setSaved("idle");
  }, []);

  const undo = useCallback(() => {
    const cur = diagramRef.current;
    // Des propriétés en cours de modification : « annuler » les abandonne d'abord.
    if (draftRef.current) {
      draftRef.current = null;
      setDraft(null);
      return;
    }
    if (!past.length || !cur) return;
    const prev = past[past.length - 1];
    setFuture((f) => [cur, ...f].slice(0, HISTORY_MAX));
    setPast(past.slice(0, -1));
    diagramRef.current = prev;
    setDiagram(prev);
    dirty.current = true;
    setSaved("idle");
  }, [past]);
  const redo = useCallback(() => {
    const cur = diagramRef.current;
    if (!future.length || !cur) return;
    const next = future[0];
    setPast((p) => [...p, cur].slice(-HISTORY_MAX));
    setFuture(future.slice(1));
    diagramRef.current = next;
    setDiagram(next);
    dirty.current = true;
    setSaved("idle");
  }, [future]);

  // ── Enregistrement automatique ──
  const save = useCallback(
    async (d: Diagram, keepalive = false) => {
      setSaved("saving");
      try {
        const body = JSON.stringify({ diagram: clean(d) });
        if (keepalive) await fetch(`/api/labs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body, keepalive: true });
        else await api.patch(`/api/labs/${id}`, { diagram: clean(d) });
        if (diagramRef.current === d) dirty.current = false;
        setSaved("saved");
      } catch {
        setSaved("error");
      }
    },
    [id]
  );
  useEffect(() => {
    if (!diagram || !dirty.current) return;
    const t = setTimeout(() => void save(diagram), 1200);
    return () => clearTimeout(t);
  }, [diagram, save]);

  const saveSubject = useCallback(
    async (text: string, keepalive = false) => {
      setSubjectSaved("saving");
      try {
        if (keepalive) await fetch(`/api/labs/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statement: text }), keepalive: true });
        else await api.patch(`/api/labs/${id}`, { statement: text });
        subjectDirty.current = false;
        setSubjectSaved("saved");
      } catch {
        setSubjectSaved("error");
      }
    },
    [id]
  );
  useEffect(() => {
    if (!subjectDirty.current) return;
    const t = setTimeout(() => void saveSubject(statement), 1000);
    return () => clearTimeout(t);
  }, [statement, saveSubject]);

  // En quittant la page ou le module, rien n'est perdu : enregistrement immédiat de ce qui attendait encore.
  const statementRef = useRef(statement);
  statementRef.current = statement;
  useEffect(() => {
    const flush = () => {
      if (dirty.current && diagramRef.current) void save(diagramRef.current, true);
      if (subjectDirty.current) void saveSubject(statementRef.current, true);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [save, saveSubject]);

  // État de l'écran gardé pour le retour au module (cadrage, panneau, onglet, sélection, brouillon de propriétés).
  const uiRef = useRef<UiState>({});
  uiRef.current = { panel, tab, full, inspect, selection, draft };
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(uiKey(id), JSON.stringify({ ...uiRef.current, view: viewRef.current }));
      } catch {
        /* stockage plein ou désactivé : l'écran repartira simplement de zéro */
      }
    }, 300);
    return () => clearTimeout(t);
  }, [id, panel, tab, full, inspect, selection, draft]);
  useEffect(() => {
    const persist = () => {
      try {
        localStorage.setItem(uiKey(id), JSON.stringify({ ...uiRef.current, view: viewRef.current }));
      } catch {
        /* idem */
      }
    };
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("pagehide", persist);
      persist();
    };
  }, [id]);

  const commitDraft = useCallback(() => {
    const d = draftRef.current;
    if (!d) return;
    change(d);
    void save(d);
  }, [change, save]);

  /** Montre l'onglet des propriétés (en rouvrant le panneau s'il est replié). */
  const openProps = useCallback(() => {
    setPanel(true);
    setTab("props");
  }, []);

  const say = useCallback((m: string) => {
    setFlash(m);
    setTimeout(() => setFlash((f) => (f === m ? null : f)), 3500);
  }, []);

  // ── Actions d'édition ──
  const addNode = useCallback(
    (type: DiagramNode["type"]) => {
      const d = current();
      if (!d) return;
      const c = canvas.current?.viewCenter() ?? { x: 200, y: 160 };
      const jitter = (d.nodes.length % 5) * 24;
      const base: DiagramNode =
        type === "entity"
          ? { id: newId("e", d), type, name: "ENTITÉ", x: 0, y: 0, attributes: [{ name: "id", key: true }], methods: [] }
          : type === "association"
            ? { id: newId("a", d), type, name: "ASSOCIATION", x: 0, y: 0, attributes: [], methods: [] }
            : type === "class"
              ? { id: newId("c", d), type, name: "Classe", x: 0, y: 0, attributes: [{ name: "attribut", type: "String", visibility: "-" }], methods: [] }
              : { id: newId("n", d), type, name: "Note", text: "Note", x: 0, y: 0, attributes: [], methods: [] };
      const s = nodeSize(base, d.kind);
      const node = { ...base, x: Math.round(c.x - s.w / 2 + jitter), y: Math.round(c.y - s.h / 2 + jitter) };
      change({ ...d, nodes: [...d.nodes, node] });
      setSelection([node.id]);
      setInspect(node.id);
      setTool("select");
      openProps();
    },
    [change, current, openProps]
  );

  const connect = useCallback(
    (fromId: string, toId: string) => {
      const d = current();
      if (!d || fromId === toId) return;
      const a = d.nodes.find((n) => n.id === fromId);
      const b = d.nodes.find((n) => n.id === toId);
      if (!a || !b) return;
      if (a.type === "note" || b.type === "note") return say("Une note ne se relie pas : elle commente le diagramme.");
      if (d.kind === "mcd") {
        if (a.type === "association" && b.type === "association") return say("Deux associations ne se relient pas directement : passez par une entité.");
        if (a.type === "entity" && b.type === "entity") {
          // Deux entités : on crée l'association entre elles, avec ses deux pattes à compléter.
          const sa = nodeSize(a, "mcd");
          const sb = nodeSize(b, "mcd");
          const assoc: DiagramNode = { id: newId("a", d), type: "association", name: "ASSOCIATION", x: 0, y: 0, attributes: [], methods: [] };
          const s = nodeSize(assoc, "mcd");
          assoc.x = Math.round((a.x + sa.w / 2 + b.x + sb.w / 2) / 2 - s.w / 2);
          assoc.y = Math.round((a.y + sa.h / 2 + b.y + sb.h / 2) / 2 - s.h / 2);
          const withAssoc = { ...d, nodes: [...d.nodes, assoc] };
          const l1: DiagramLink = { id: newId("l", withAssoc), from: a.id, to: assoc.id, type: "mcd" };
          const l2: DiagramLink = { id: newId("l", { ...withAssoc, links: [l1] }), from: b.id, to: assoc.id, type: "mcd" };
          change({ ...withAssoc, links: [...d.links, l1, l2] });
          setSelection([assoc.id]);
          setInspect(assoc.id);
          say("Association créée : nommez-la, puis placez les cardinalités de chaque patte.");
          return;
        }
        const entity = a.type === "entity" ? a : b;
        const assoc = a.type === "association" ? a : b;
        const link: DiagramLink = { id: newId("l", d), from: entity.id, to: assoc.id, type: "mcd" };
        change({ ...d, links: [...d.links, link] });
        setSelection([link.id]);
        setInspect(link.id);
        return;
      }
      const link: DiagramLink = { id: newId("l", d), from: a.id, to: b.id, type: "association" };
      change({ ...d, links: [...d.links, link] });
      setSelection([link.id]);
      setInspect(link.id);
    },
    [change, say, current]
  );

  const onLinkClick = useCallback(
    (nodeId: string) => {
      if (!linkFrom) {
        setLinkFrom(nodeId);
        return;
      }
      connect(linkFrom, nodeId);
      setLinkFrom(null);
    },
    [linkFrom, connect]
  );

  const remove = useCallback(
    (ids: string[]) => {
      const d = current();
      if (!d || !ids.length) return;
      const gone = new Set(ids);
      change({ ...d, nodes: d.nodes.filter((n) => !gone.has(n.id)), links: d.links.filter((l) => !gone.has(l.id) && !gone.has(l.from) && !gone.has(l.to)) });
      setSelection([]);
      setInspect(null);
    },
    [change, current]
  );

  // Propriétés : modifiées en brouillon (visible sur la grille), gardées seulement avec « Enregistrer ».
  const setDraftTo = useCallback((next: Diagram) => {
    draftRef.current = next;
    setDraft(next);
  }, []);
  const patchNode = useCallback((nid: string, patch: Partial<DiagramNode>) => {
    const d = current();
    if (d) setDraftTo({ ...d, nodes: d.nodes.map((n) => (n.id === nid ? { ...n, ...patch } : n)) });
  }, [current, setDraftTo]);
  const patchLink = useCallback((lid: string, patch: Partial<DiagramLink>) => {
    const d = current();
    if (d) setDraftTo({ ...d, links: d.links.map((l) => (l.id === lid ? { ...l, ...patch } : l)) });
  }, [current, setDraftTo]);

  const onMove = useCallback(
    (pos: Record<string, Point>, commit: boolean) => {
      const d = current();
      if (!d) return;
      const next = { ...d, nodes: d.nodes.map((n) => (pos[n.id] ? { ...n, ...pos[n.id] } : n)) };
      if (commit) {
        // Une seule entrée d'historique par déplacement : l'état d'avant le glisser.
        setPast((p) => [...p.slice(-HISTORY_MAX + 1), dragStart.current ?? d]);
        setFuture([]);
        dragStart.current = null;
        draftRef.current = null;
        setDraft(null);
        diagramRef.current = next;
        setDiagram(next);
        dirty.current = true;
        setSaved("idle");
      } else {
        if (!dragStart.current) dragStart.current = diagramRef.current ?? d;
        if (draftRef.current) {
          draftRef.current = next;
          setDraft(next);
        } else {
          diagramRef.current = next;
          setDiagram(next);
        }
      }
    },
    [current]
  );
  const dragStart = useRef<Diagram | null>(null);

  // ── Clavier ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selectionRef.current.length) { e.preventDefault(); remove(selectionRef.current); }
      else if (e.key === "Escape") { setLinkFrom(null); setTool("select"); setFull(false); }
      else if (!mod && e.key.toLowerCase() === "l") setTool((x) => (x === "link" ? "select" : "link"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, remove]);

  // ── Sujet : un ou plusieurs fichiers (PDF ou images), ajoutés à la suite du sujet ──
  async function importFiles(files: File[]) {
    if (!files.length) return;
    if (files.length > 10) return setSubjectError("10 fichiers au maximum par import.");
    setImporting(true);
    setSubjectError(null);
    try {
      // Le texte en cours de frappe est enregistré d'abord : l'import s'ajoute à la suite.
      if (subjectDirty.current) await saveSubject(statementRef.current);
      const form = new FormData();
      for (const f of files) form.append("file", f);
      const r = await api.post<{ workspace: LabWorkspaceDto }>(`/api/labs/${id}/subject`, form);
      subjectDirty.current = false;
      setStatement(r.workspace.brief?.statement ?? "");
      setWs(r.workspace);
      setSubjectSaved("saved");
    } catch (e) {
      setSubjectError(errText(e, "Import impossible."));
    } finally {
      setImporting(false);
    }
  }

  // ── Export image ──
  function exportImage(format: "svg" | "png") {
    const svg = canvas.current?.svg();
    const d = diagramRef.current;
    const b = d && bounds(d);
    if (!svg || !b) return say("Le diagramme est vide.");
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const m = 40;
    clone.setAttribute("viewBox", `${b.x - m} ${b.y - m} ${b.w + 2 * m} ${b.h + 2 * m}`);
    clone.setAttribute("width", String(b.w + 2 * m));
    clone.setAttribute("height", String(b.h + 2 * m));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.removeAttribute("class");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", String(b.x - m));
    bg.setAttribute("y", String(b.y - m));
    bg.setAttribute("width", String(b.w + 2 * m));
    bg.setAttribute("height", String(b.h + 2 * m));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild?.nextSibling ?? null);
    // Les couleurs du thème sont des variables CSS : on les fige en couleurs claires lisibles hors de l'application.
    const fixed: Record<string, string> = { "--foreground": "#1f1a2b", "--muted-foreground": "#5b5368", "--card": "#ffffff", "--primary": "#6e51a1", "--border": "#dcd4e5" };
    let text = new XMLSerializer().serializeToString(clone);
    for (const [k, v] of Object.entries(fixed)) text = text.split(`var(${k})`).join(v);
    text = text.replace(/color-mix\([^)]*\)\)?/g, "#ece6f5");
    const name = (title || "diagramme").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60);
    const download = (href: string, ext: string) => {
      const a = document.createElement("a");
      a.href = href;
      a.download = `${name}.${ext}`;
      a.click();
    };
    const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    if (format === "svg") {
      download(url, "svg");
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const c = document.createElement("canvas");
      c.width = (b.w + 2 * m) * scale;
      c.height = (b.h + 2 * m) * scale;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      download(c.toDataURL("image/png"), "png");
    };
    img.src = url;
  }

  async function removeWorkspace() {
    if (!(await confirmAction("Supprimer ce diagramme ?", { confirmLabel: "Supprimer" }))) return;
    try {
      await api.del(`/api/labs/${id}`);
      localStorage.removeItem(LAST_DIAGRAM_KEY);
      localStorage.removeItem(uiKey(id));
      router.push(`${routes.diagrams}?liste=1`);
    } catch (e) {
      say(errText(e, "Suppression impossible."));
    }
  }

  async function rename() {
    const t = title.trim();
    if (!ws || !t || t === ws.title) return setTitle(ws?.title ?? "");
    try {
      const r = await api.patch<{ workspace: LabWorkspaceDto }>(`/api/labs/${id}`, { title: t });
      setWs((w) => (w ? { ...w, title: r.workspace.title } : w));
    } catch (e) {
      say(errText(e, "Renommage impossible."));
    }
  }

  const warnings = useMemo(() => (diagram ? diagramWarnings(clean(diagram)) : []), [diagram]);
  const mld = useMemo(() => (diagram?.kind === "mcd" ? mcdToMld(clean(diagram)) : []), [diagram]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Alert variant="destructive"><AlertTitle>{error.status === 404 ? "Diagramme introuvable" : "Chargement impossible"}</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
        <Button asChild variant="outline" className="mt-6"><Link href={routes.diagrams}>Retour aux diagrammes</Link></Button>
      </div>
    );
  }
  if (!ws || !diagram) return <DiagramWorkspaceSkeleton />;

  const shown = draft ?? diagram;
  const mcd = diagram.kind === "mcd";
  const documents = ws.brief?.source?.documents ?? (ws.brief?.source?.documentName ? [ws.brief.source.documentName] : []);
  const toolBtn = (active: boolean) => cn("h-8 gap-1.5 px-2 text-xs", active && "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground");

  return (
    <div className={cn("mx-auto w-full px-4 sm:px-6", full ? "flex h-full flex-col pt-3 pb-[calc(0.75rem+var(--toolbar-clearance,0px))]" : "max-w-[1600px] pt-6 pb-[calc(1.5rem+var(--toolbar-clearance,0px))]")}>
      <nav aria-label="Fil d'Ariane" className={cn("mb-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground", full && "hidden")}>
        <Link href={`${routes.diagrams}?liste=1`} className="hover:text-foreground">Laboratoire de diagrammes</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <span>{statement.trim() ? "Exercice" : "Espace libre"}</span>
      </nav>
      <div className={cn("mb-3 flex flex-wrap items-center gap-2", full && "hidden")}>
        <Input aria-label="Titre du diagramme" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className="typo-h1 mr-auto h-auto min-w-0 max-w-xl flex-1 border-transparent bg-transparent px-1 shadow-none hover:border-input focus-visible:border-input" />
        <Badge variant="outline">{DIAGRAM_KINDS[diagram.kind]}</Badge>
        <span className="text-xs text-muted-foreground" aria-live="polite">{saved === "saving" ? "Enregistrement…" : saved === "saved" ? "Enregistré" : saved === "error" ? "Échec de l'enregistrement" : ""}</span>
        <Button variant="ghost" size="sm" className="gap-1 text-destructive" onClick={() => void removeWorkspace()}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>
      </div>

      <div className={cn("grid gap-4", panel && "xl:grid-cols-[minmax(0,1fr)_400px]", full && "min-h-0 flex-1 xl:grid-rows-1")}>
        <section aria-label="Éditeur de diagramme" className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card", full ? "h-full min-h-[360px]" : "h-[calc(68vh+5.5rem)] min-h-[540px]")}>
          <div role="toolbar" aria-label="Outils du diagramme" className="flex flex-wrap items-center gap-1 border-b p-2">
            <Button variant="ghost" size="sm" className={toolBtn(tool === "select")} onClick={() => { setTool("select"); setLinkFrom(null); }} aria-pressed={tool === "select"} title="Sélectionner et déplacer (Échap)"><MousePointer2 className="h-4 w-4" aria-hidden /> Sélection</Button>
            <Button variant="ghost" size="sm" className={toolBtn(tool === "link")} onClick={() => { setTool("link"); setLinkFrom(null); }} aria-pressed={tool === "link"} title="Relier deux éléments (L)"><Spline className="h-4 w-4" aria-hidden /> Relier</Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            {mcd ? (
              <>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => addNode("entity")}><Square className="h-4 w-4" aria-hidden /> Entité</Button>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => addNode("association")}><CircleDot className="h-4 w-4" aria-hidden /> Association</Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => addNode("class")}><Box className="h-4 w-4" aria-hidden /> Classe</Button>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => addNode("note")}><StickyNote className="h-4 w-4" aria-hidden /> Note</Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={!past.length} aria-label="Annuler (Ctrl+Z)" title="Annuler (Ctrl+Z)"><Undo2 className="h-4 w-4" aria-hidden /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={redo} disabled={!future.length} aria-label="Rétablir (Ctrl+Y)" title="Rétablir (Ctrl+Y)"><Redo2 className="h-4 w-4" aria-hidden /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => remove(selection)} disabled={!selection.length} aria-label="Supprimer la sélection (Suppr)" title="Supprimer la sélection (Suppr)"><Trash2 className="h-4 w-4" aria-hidden /></Button>
            <span className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => canvas.current?.zoomBy(1 / 1.2)} aria-label="Dézoomer"><ZoomOut className="h-4 w-4" aria-hidden /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => canvas.current?.zoomBy(1.2)} aria-label="Zoomer"><ZoomIn className="h-4 w-4" aria-hidden /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => canvas.current?.fit()} aria-label="Tout afficher"><Maximize className="h-4 w-4" aria-hidden /></Button>
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => exportImage("png")} title="Télécharger en image PNG"><Download className="h-4 w-4" aria-hidden /> PNG</Button>
              <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" onClick={() => exportImage("svg")} title="Télécharger en SVG (vectoriel)">SVG</Button>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setFull((f) => !f)} aria-pressed={full} aria-label={full ? "Quitter le plein écran" : "Grille en plein écran"} title={full ? "Quitter le plein écran (Échap)" : "Grille en plein écran"}>{full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}</Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPanel((p) => !p)} aria-pressed={panel} aria-label={panel ? "Masquer le panneau latéral" : "Afficher le panneau latéral"} title={panel ? "Masquer le panneau (assistant, propriétés, sujet)" : "Afficher le panneau (assistant, propriétés, sujet)"}>{panel ? <PanelRightClose className="h-4 w-4" aria-hidden /> : <PanelRightOpen className="h-4 w-4" aria-hidden />}</Button>
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            <DiagramCanvas
              ref={canvas}
              diagram={shown}
              initialView={ui.view}
              onViewChange={(v) => { viewRef.current = v; }}
              selection={selection}
              tool={tool}
              linkFrom={linkFrom}
              onSelect={(ids) => {
                setSelection(ids);
                setInspect(ids.length === 1 ? ids[0] : null);
                // Une patte ou une relation est fine à double-cliquer : un clic suffit à montrer ses propriétés.
                if (ids.length === 1 && shown.links.some((l) => l.id === ids[0])) openProps();
              }}
              onMove={onMove}
              onLinkClick={onLinkClick}
              onOpen={(nid) => { setSelection([nid]); setInspect(nid); openProps(); }}
            />
            {(tool === "link" || flash || diagram.nodes.length === 0) && (
              <p role="status" className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] rounded-md border bg-background/95 px-3 py-1.5 text-xs shadow-sm">
                {flash ?? (tool === "link" ? (linkFrom ? "Cliquez maintenant sur l'élément à relier." : mcd ? "Cliquez sur une entité puis sur une association (ou sur une autre entité : l'association est créée entre les deux)." : "Cliquez sur une classe puis sur l'autre classe. Pour l'héritage, partez de la classe fille.") : mcd ? "Ajoutez des entités et des associations, ou demandez à l'assistant de construire le MCD à partir du sujet." : "Ajoutez des classes, ou demandez à l'assistant de construire le diagramme à partir du sujet.")}
              </p>
            )}
          </div>
          <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">Glisser le fond pour se déplacer · Ctrl + molette pour zoomer · double-clic pour modifier · Maj + clic pour sélectionner plusieurs éléments · Suppr pour effacer</p>
        </section>

        <Tabs value={tab} onValueChange={setTab} className={cn("min-w-0 flex-col gap-2", panel ? "flex" : "hidden", full ? "h-full min-h-0" : "xl:h-[calc(68vh+5.5rem)] xl:min-h-[540px]")}>
          <TabsList className="grid w-full shrink-0 grid-cols-4">
            <TabsTrigger value="assistant">Assistant</TabsTrigger>
            <TabsTrigger value="props">Propriétés{draft ? " •" : ""}</TabsTrigger>
            <TabsTrigger value="subject">Sujet{statement.trim() ? " ✓" : ""}</TabsTrigger>
            <TabsTrigger value="check">Vérifier{warnings.length ? ` (${warnings.length})` : ""}</TabsTrigger>
          </TabsList>

          {/* Toujours montée : la discussion survit au changement d'onglet. */}
          <TabsContent value="assistant" forceMount className="mt-0 h-[70vh] min-h-[480px] rounded-xl border bg-card p-4 xl:h-auto xl:min-h-0 xl:flex-1 data-[state=inactive]:hidden">
            <DiagramAssistant storageKey={diagramChatKey(id)} workspaceId={id} kind={diagram.kind} hasSubject={!!statement.trim()} getDiagram={() => clean(diagramRef.current ?? diagram)} getSelection={() => selectionRef.current} onApply={(d) => { change(d); setSelection([]); setInspect(null); requestAnimationFrame(() => canvas.current?.fit()); }} />
          </TabsContent>

          <TabsContent value="props" className="mt-0 min-h-[360px] rounded-xl border bg-card p-4 xl:min-h-0 xl:flex-1">
            <Inspector
              diagram={shown}
              id={inspect}
              onNode={patchNode}
              onLink={patchLink}
              onDelete={remove}
              onClose={() => { setInspect(null); setSelection([]); }}
              dirty={!!draft}
              onSave={commitDraft}
              onCancel={() => { draftRef.current = null; setDraft(null); }}
            />
          </TabsContent>

          <TabsContent value="subject" className="mt-0 space-y-3 overflow-y-auto rounded-xl border bg-card p-4 xl:min-h-0 xl:flex-1">
            <div>
              <h2 className="typo-h3">Sujet de l&apos;exercice</h2>
              <p className="text-xs text-muted-foreground">Collez l&apos;énoncé ou importez-le (PDF ou images, plusieurs fichiers à la fois) : l&apos;assistant s&apos;en sert pour vous aider.</p>
            </div>
            <label
              className={cn("flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-3 text-center text-sm hover:bg-muted", importing && "pointer-events-none opacity-60")}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void importFiles(Array.from(e.dataTransfer.files)); }}
            >
              <span className="flex items-center gap-2">{importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="h-4 w-4" aria-hidden />}{importing ? "Lecture des fichiers…" : "Importer le sujet (PDF ou images)"}</span>
              <span className="text-[11px] text-muted-foreground">Jusqu&apos;à 10 fichiers, ajoutés à la suite du sujet. Les images et les PDF scannés sont lus par l&apos;IA.</span>
              <input type="file" multiple accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void importFiles(fs); }} />
            </label>
            {documents.length > 0 && statement.trim() && <p className="text-xs text-muted-foreground">Texte tiré de {documents.map((d) => `« ${d} »`).join(", ")}. Vérifiez-le et corrigez-le si besoin ci-dessous.</p>}
            {subjectError && <p role="alert" className="text-sm text-destructive">{subjectError}</p>}
            <Textarea aria-label="Texte du sujet" value={statement} maxLength={30_000} rows={16} placeholder="Ou collez ici le texte de l'exercice…" className="text-sm" onChange={(e) => { subjectDirty.current = true; setSubjectSaved("idle"); setStatement(e.target.value); }} />
            <p className="text-xs text-muted-foreground" aria-live="polite">{subjectSaved === "saving" ? "Enregistrement…" : subjectSaved === "saved" ? "Sujet enregistré" : subjectSaved === "error" ? "Échec de l'enregistrement du sujet" : `${statement.length.toLocaleString("fr-FR")} / 30 000 caractères`}</p>
          </TabsContent>

          <TabsContent value="check" className="mt-0 space-y-4 overflow-y-auto rounded-xl border bg-card p-4 xl:min-h-0 xl:flex-1">
            <section>
              <h2 className="typo-h3 mb-1 flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden /> Vérifications de notation</h2>
              {warnings.length ? (
                <ul className="list-disc space-y-1 pl-5 text-sm">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              ) : (
                <p className="text-sm text-muted-foreground">{diagram.nodes.length ? "Aucun problème de notation repéré. Cela ne garantit pas que le modèle réponde au sujet : demandez l'avis de l'assistant." : "Le diagramme est vide."}</p>
              )}
            </section>
            {mcd && (
              <section>
                <h2 className="typo-h3 mb-1 flex items-center gap-2"><Table2 className="h-4 w-4" aria-hidden /> Modèle logique (MLD)</h2>
                <p className="mb-2 text-xs text-muted-foreground">Déduit automatiquement de votre MCD avec les règles de passage de Merise. Clé primaire soulignée, clé étrangère précédée de #.</p>
                {mld.length ? (
                  <ul className="space-y-2">
                    {mld.map((t) => (
                      <li key={t.name} className="rounded-md border p-2">
                        <p className="font-code text-sm">
                          <strong>{t.name}</strong> ({t.columns.map((c, i) => (
                            <span key={i}>{i > 0 && ", "}<span className={cn(c.pk && "underline font-semibold")} title={c.fk ? `Clé étrangère vers ${c.fk}` : c.pk ? "Clé primaire" : undefined}>{c.fk ? <span className="text-primary">#</span> : null}{c.name}</span></span>
                          ))})
                        </p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{t.rule}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">Ajoutez des entités pour voir le modèle logique.</p>
                )}
              </section>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
