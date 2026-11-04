"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { ArrowLeft, History, LayoutGrid, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { api, ApiError } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { layoutLayers, layoutTree } from "@/server/domain/map-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ORIGIN_LABEL, RELATION_LABEL, type MapDetail, type MapEdgeDto, type MapNodeDto, type Origin, type RelationType } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Éditeur de carte (React Flow) : un GRAPHE éditable — ajout/suppression/édition de nœuds,
// création/suppression/typage de relations, déplacement, zoom, sauvegarde automatique,
// versions. La provenance de chaque élément est visible et décidée par le serveur.
// ─────────────────────────────────────────────────────────────────────────────

interface NodeData extends Record<string, unknown> {
  label: string;
  origin: Origin;
  edited?: boolean;
  page?: number | null;
  note?: string;
  definition?: string;
  conceptId: string | null;
  sectionId: string | null;
}
interface EdgeData extends Record<string, unknown> {
  type: RelationType;
  origin: Origin;
  label: string | null;
}
type FlowNode = Node<NodeData, "card">;
type FlowEdge = Edge<EdgeData>;
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

const rid = (p: string) => p + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
const ORIGIN_STYLE: Record<Origin, string> = {
  DOCUMENT: "border-emerald-500 bg-card",
  AI_INFERRED: "border-amber-500 border-dashed bg-amber-50/60 dark:bg-amber-950/20",
  USER: "border-sky-500 bg-sky-50/60 dark:bg-sky-950/20",
};
const EDGE_COLOR: Record<Origin, string> = { DOCUMENT: "#10b981", AI_INFERRED: "#f59e0b", USER: "#0ea5e9" };

function CardNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow<FlowNode, FlowEdge>();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(data.label);
  useEffect(() => setText(data.label), [data.label]);
  const commit = () => {
    setEditing(false);
    const t = text.trim();
    if (t && t !== data.label) updateNodeData(id, { label: t.slice(0, 200) });
    else setText(data.label);
  };
  return (
    <div
      onDoubleClick={() => setEditing(true)}
      className={cn("min-w-28 max-w-60 rounded-lg border-2 px-3 py-2 text-sm text-foreground shadow-sm", ORIGIN_STYLE[data.origin], selected && "ring-2 ring-primary")}
      title={`${ORIGIN_LABEL[data.origin]}${data.edited ? " · modifié par vous" : ""} — double-clic pour modifier`}
    >
      <Handle id="l" type="source" position={Position.Left} className="!h-2.5 !w-2.5" />
      {editing ? (
        <input
          autoFocus
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setText(data.label);
              setEditing(false);
            }
          }}
          className="nodrag w-full bg-transparent outline-none"
          aria-label="Contenu du nœud"
        />
      ) : (
        <span className="block break-words font-medium leading-snug">{data.label}</span>
      )}
      {(data.edited || data.page) && (
        <span className="mt-1 block text-[10px] text-muted-foreground">
          {data.page ? `p. ${data.page}` : ""}
          {data.edited ? `${data.page ? " · " : ""}modifié` : ""}
        </span>
      )}
      <Handle id="r" type="source" position={Position.Right} className="!h-2.5 !w-2.5" />
    </div>
  );
}
const nodeTypes = { card: CardNode };

const toFlowNode = (n: MapNodeDto): FlowNode => ({
  id: n.id,
  type: "card",
  position: { x: n.x, y: n.y },
  data: { label: n.label, origin: n.origin, edited: n.data?.edited, page: n.data?.page ?? null, note: n.data?.note, definition: n.data?.definition, conceptId: n.conceptId, sectionId: n.sectionId },
});

function toFlowEdge(e: MapEdgeDto, showArrows: boolean, handles?: { s: string; t: string }): FlowEdge {
  const color = EDGE_COLOR[e.origin];
  // plan : l'enfant (à droite) se relie par sa gauche à la droite du parent ; carte conceptuelle : l'inverse
  const h = handles ?? (showArrows ? { s: "r", t: "l" } : { s: "l", t: "r" });
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: h.s,
    targetHandle: h.t,
    data: { type: e.type, origin: e.origin, label: e.label },
    label: e.label || (e.type === "PART_OF" && !showArrows ? undefined : RELATION_LABEL[e.type]),
    style: { stroke: color, strokeDasharray: e.origin === "AI_INFERRED" ? "6 4" : undefined, strokeWidth: 1.8 },
    labelStyle: { fontSize: 11 },
    markerEnd: showArrows ? { type: MarkerType.ArrowClosed, color } : undefined,
  };
}

export default function MapEditor(props: { map: MapDetail }) {
  return (
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>
  );
}

function Editor({ map: initial }: { map: MapDetail }) {
  const showArrows = initial.kind === "CONCEPT";
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<FlowNode>(initial.nodes.map(toFlowNode));
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<FlowEdge>(initial.edges.map((e) => toFlowEdge(e, showArrows)));
  const [title, setTitle] = useState(initial.title);
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState(initial.revisions);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [selEdge, setSelEdge] = useState<string | null>(null);
  const rf = useReactFlow<FlowNode, FlowEdge>();
  const { resolvedTheme } = useTheme();

  const revision = useRef(initial.revision);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const titleRef = useRef(title);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  titleRef.current = title;
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<SaveState>("saved");
  stateRef.current = save;
  const current = () => stateRef.current as SaveState;

  const payload = useCallback(
    () => ({
      revision: revision.current,
      title: titleRef.current.trim() || "Carte sans titre",
      nodes: nodesRef.current.map((n) => ({
        id: n.id,
        label: n.data.label.trim() || "Sans titre",
        x: Math.round(n.position.x),
        y: Math.round(n.position.y),
        origin: n.data.origin,
        data: { ...(n.data.note ? { note: n.data.note } : {}) },
      })),
      edges: edgesRef.current.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.data!.type, label: e.data!.label, origin: e.data!.origin })),
    }),
    []
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current || current() === "conflict") return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    dirty.current = false;
    inFlight.current = true;
    setSave("saving");
    try {
      const res = await api.put<{ revision: number }>(`/api/maps/${initial.id}`, payload());
      revision.current = res.revision;
      setSave(dirty.current ? "dirty" : "saved");
      setSaveError(null);
    } catch (e) {
      dirty.current = true;
      if (e instanceof ApiError && e.status === 409) setSave("conflict");
      else {
        setSave("error");
        setSaveError(e instanceof Error ? e.message : "Enregistrement impossible.");
      }
    } finally {
      inFlight.current = false;
      if (again.current && current() !== "conflict" && current() !== "error") {
        again.current = false;
        void flush();
      }
    }
  }, [initial.id, payload]);

  const markDirty = useCallback(() => {
    dirty.current = true;
    setSave((s) => (s === "conflict" ? s : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 1200);
  }, [flush]);

  // Envoi à la fermeture de l'onglet
  useEffect(() => {
    const onHide = () => {
      if (!dirty.current || current() === "conflict") return;
      void fetch(`/api/maps/${initial.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()), keepalive: true, credentials: "same-origin" }).catch(() => undefined);
      dirty.current = false;
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [initial.id, payload]);

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      onNodesChangeRaw(changes);
      if (changes.some((c) => c.type === "remove" || c.type === "add" || (c.type === "position" && c.dragging === false))) markDirty();
    },
    [onNodesChangeRaw, markDirty]
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      onEdgesChangeRaw(changes);
      if (changes.some((c) => c.type === "remove" || c.type === "add")) markDirty();
    },
    [onEdgesChangeRaw, markDirty]
  );

  // Les changements de données (libellé édité sur le nœud) passent par updateNodeData : on les détecte ici
  const lastLabels = useRef(new Map(initial.nodes.map((n) => [n.id, n.label])));
  useEffect(() => {
    let changed = false;
    for (const n of nodes) {
      if (lastLabels.current.get(n.id) !== n.data.label) {
        changed = true;
        lastLabels.current.set(n.id, n.data.label);
      }
    }
    if (changed) markDirty();
  }, [nodes, markDirty]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      if (edgesRef.current.some((e) => e.source === c.source && e.target === c.target && e.data?.type === "RELATED")) return;
      const created = toFlowEdge({ id: rid("e"), source: c.source, target: c.target, type: "RELATED", label: null, origin: "USER" }, showArrows, { s: c.sourceHandle ?? "r", t: c.targetHandle ?? "l" });
      setEdges((es) => addEdge(created, es));
      markDirty();
    },
    [setEdges, markDirty, showArrows]
  );

  function addNode() {
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const node: FlowNode = { id: rid("n"), type: "card", position: { x: Math.round(center.x), y: Math.round(center.y) }, data: { label: "Nouvelle idée", origin: "USER", conceptId: null, sectionId: null } };
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    markDirty();
  }

  function relayout() {
    const lay = initial.kind === "STRUCTURE" ? layoutTree : layoutLayers;
    const pos = lay(nodesRef.current.map((n) => ({ id: n.id })), edgesRef.current.map((e) => ({ source: e.source, target: e.target, type: e.data!.type })));
    setNodes((ns) => ns.map((n) => (pos[n.id] ? { ...n, position: pos[n.id] } : n)));
    markDirty();
    setTimeout(() => void rf.fitView({ duration: 300, padding: 0.2 }), 50);
  }

  function deleteSelection() {
    const ns = nodesRef.current.filter((n) => n.selected).map((n) => ({ id: n.id }));
    const es = edgesRef.current.filter((e) => e.selected).map((e) => ({ id: e.id }));
    if (ns.length || es.length) void rf.deleteElements({ nodes: ns, edges: es });
  }

  async function reload() {
    const r = await api.get<{ map: MapDetail }>(`/api/maps/${initial.id}`);
    dirty.current = false;
    revision.current = r.map.revision;
    lastLabels.current = new Map(r.map.nodes.map((n) => [n.id, n.label]));
    setNodes(r.map.nodes.map(toFlowNode));
    setEdges(r.map.edges.map((e) => toFlowEdge(e, showArrows)));
    setTitle(r.map.title);
    setRevisions(r.map.revisions);
    setSave("saved");
  }
  async function keepMine() {
    try {
      const r = await api.get<{ map: MapDetail }>(`/api/maps/${initial.id}`);
      revision.current = r.map.revision;
    } catch {
      return;
    }
    dirty.current = true;
    stateRef.current = "dirty";
    setSave("dirty");
    void flush();
  }
  /** Liste à jour des versions à chaque ouverture du menu (une version automatique peut avoir été créée à la sauvegarde). */
  async function refreshRevisions(open: boolean) {
    if (!open) return;
    await flush();
    try {
      const r = await api.get<{ map: MapDetail }>(`/api/maps/${initial.id}`);
      setRevisions(r.map.revisions);
    } catch {
      /* la liste précédente reste affichée */
    }
  }
  async function restorePoint() {
    await flush();
    await api.post(`/api/maps/${initial.id}/revisions`);
    const r = await api.get<{ map: MapDetail }>(`/api/maps/${initial.id}`);
    setRevisions(r.map.revisions);
  }
  async function restore(n: number) {
    if (!window.confirm("Revenir à cette version ? L'état actuel est conservé comme version.")) return;
    await flush();
    const r = await api.post<{ map: MapDetail }>(`/api/maps/${initial.id}/revisions/${n}/restore`);
    dirty.current = false;
    revision.current = r.map.revision;
    lastLabels.current = new Map(r.map.nodes.map((nn) => [nn.id, nn.label]));
    setNodes(r.map.nodes.map(toFlowNode));
    setEdges(r.map.edges.map((e) => toFlowEdge(e, showArrows)));
    setTitle(r.map.title);
    setRevisions(r.map.revisions);
    setSave("saved");
  }

  const node = nodes.find((n) => n.id === selNode) ?? null;
  const edge = edges.find((e) => e.id === selEdge) ?? null;
  const updateEdge = (id: string, patch: Partial<EdgeData>) => {
    setEdges((es) =>
      es.map((e) => {
        if (e.id !== id) return e;
        const d = { ...e.data!, ...patch };
        // un élément que l'étudiant modifie lui appartient désormais
        return toFlowEdge({ id: e.id, source: e.source, target: e.target, type: d.type, label: d.label, origin: "USER" }, showArrows, { s: e.sourceHandle ?? "r", t: e.targetHandle ?? "l" });
      })
    );
    markDirty();
  };
  const sel = useMemo(() => nodes.some((n) => n.selected) || edges.some((e) => e.selected), [nodes, edges]);

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[30rem] flex-col md:h-[calc(100dvh-3.25rem)]">
      <header className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link href={`${routes.subject(initial.subjectId)}/cartes`} aria-label="Retour aux cartes"><ArrowLeft className="h-4 w-4" aria-hidden /></Link>
        </Button>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
          }}
          aria-label="Titre de la carte"
          maxLength={160}
          className="h-8 min-w-40 max-w-sm flex-1 border-0 px-1 font-semibold shadow-none focus-visible:ring-1"
        />
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{initial.kind === "STRUCTURE" ? "Carte de structure" : "Carte conceptuelle"}</span>
        {initial.document && (
          <Link href={`${routes.subject(initial.subjectId)}/documents/${initial.document.id}`} className="truncate text-xs text-primary hover:underline">{initial.document.name}</Link>
        )}
        <span role="status" aria-live="polite" className={cn("ml-auto flex items-center gap-1.5 text-xs", save === "error" || save === "conflict" ? "text-destructive" : "text-muted-foreground")} title={saveError ?? undefined}>
          {save === "saving" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {{ saved: "Enregistré", dirty: "Modifications en attente…", saving: "Enregistrement…", error: "Échec de l'enregistrement", conflict: "Conflit" }[save]}
          {save === "error" && <button className="underline" onClick={() => { stateRef.current = "dirty"; dirty.current = true; void flush(); }}>Réessayer</button>}
        </span>
        <DropdownMenu onOpenChange={(o) => void refreshRevisions(o)}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5"><History className="h-4 w-4" aria-hidden /> Versions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
            <DropdownMenuItem onSelect={() => void restorePoint()}><Save className="mr-2 h-4 w-4" aria-hidden /> Créer un point de restauration</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Revenir à…</DropdownMenuLabel>
            {revisions.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Aucune version pour l&apos;instant.</p>}
            {revisions.map((r) => (
              <DropdownMenuItem key={r.number} onSelect={() => void restore(r.number)}>
                Version {r.number} · {new Date(r.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {save === "conflict" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Cette carte a été modifiée ailleurs.
          <Button size="sm" variant="outline" className="bg-background" onClick={() => void reload()}>Recharger la version enregistrée</Button>
          <Button size="sm" variant="outline" className="bg-background" onClick={() => void keepMine()}>Conserver ma version</Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="min-h-0 flex-1" aria-label="Carte interactive">
          <ReactFlow<FlowNode, FlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            connectionMode={ConnectionMode.Loose}
            onSelectionChange={({ nodes: ns, edges: es }) => {
              setSelNode(ns.length === 1 ? ns[0].id : null);
              setSelEdge(es.length === 1 && ns.length === 0 ? es[0].id : null);
            }}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.1}
            maxZoom={2.5}
            colorMode={resolvedTheme === "dark" ? "dark" : "light"}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls aria-label="Zoom et vue" />
            <MiniMap pannable zoomable className="!hidden sm:!block" />
            <Panel position="top-left" className="flex gap-1.5">
              <Button size="sm" onClick={addNode} className="gap-1.5"><Plus className="h-4 w-4" aria-hidden /> Nœud</Button>
              <Button size="sm" variant="outline" onClick={relayout} className="gap-1.5 bg-background"><LayoutGrid className="h-4 w-4" aria-hidden /> Réorganiser</Button>
              <Button size="sm" variant="outline" onClick={deleteSelection} disabled={!sel} className="gap-1.5 bg-background"><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>
            </Panel>
            <Panel position="bottom-left" className="hidden rounded-lg border bg-card/90 p-2 text-[11px] sm:block">
              {(Object.keys(ORIGIN_LABEL) as Origin[]).map((o) => (
                <div key={o} className="flex items-center gap-1.5">
                  <span className={cn("inline-block h-3 w-5 rounded border-2", ORIGIN_STYLE[o])} aria-hidden /> {ORIGIN_LABEL[o]}
                </div>
              ))}
            </Panel>
          </ReactFlow>
        </div>

        <aside aria-label="Propriétés" className="max-h-56 shrink-0 overflow-y-auto border-t bg-background p-3 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
          {!node && !edge && (
            <p className="text-sm text-muted-foreground">
              Sélectionnez un nœud ou une relation pour la modifier. Double-cliquez un nœud pour changer son texte ; tirez d&apos;une poignée à une autre pour créer une relation ; molette pour zoomer.
            </p>
          )}
          {node && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Nœud</h2>
              <div className="space-y-1.5">
                <Label htmlFor="n-label">Texte</Label>
                <Textarea id="n-label" rows={2} maxLength={200} value={node.data.label} onChange={(e) => { setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, label: e.target.value } } : n))); }} onBlur={() => { if (!node.data.label.trim()) setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, label: "Sans titre" } } : n))); }} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="n-note">Commentaire</Label>
                <Textarea id="n-note" rows={3} maxLength={2000} value={node.data.note ?? ""} onChange={(e) => { setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, data: { ...n.data, note: e.target.value } } : n))); markDirty(); }} />
              </div>
              {node.data.definition && <p className="text-xs text-muted-foreground"><span className="font-semibold">Définition :</span> {node.data.definition}</p>}
              <p className="text-xs"><span className="font-semibold">Provenance :</span> {ORIGIN_LABEL[node.data.origin]}{node.data.edited ? " (texte modifié)" : ""}</p>
              {node.data.page && initial.document && (
                <Button asChild size="sm" variant="outline"><Link href={`${routes.subject(initial.subjectId)}/documents/${initial.document.id}?page=${node.data.page}`}>Voir dans le document (p. {node.data.page})</Link></Button>
              )}
              <Button size="sm" variant="outline" className="w-full gap-1.5 text-destructive" onClick={deleteSelection}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer le nœud</Button>
            </div>
          )}
          {edge && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Relation</h2>
              <p className="text-xs text-muted-foreground">
                « {nodes.find((n) => n.id === edge.source)?.data.label} » → « {nodes.find((n) => n.id === edge.target)?.data.label} »
              </p>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={edge.data!.type} onValueChange={(v) => updateEdge(edge.id, { type: v as RelationType })}>
                  <SelectTrigger aria-label="Type de relation"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.keys(RELATION_LABEL) as RelationType[]).map((t) => <SelectItem key={t} value={t}>{RELATION_LABEL[t]}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="e-label">Étiquette (facultatif)</Label>
                <Input id="e-label" maxLength={80} value={edge.data!.label ?? ""} onChange={(e) => updateEdge(edge.id, { label: e.target.value || null })} />
              </div>
              <p className="text-xs"><span className="font-semibold">Provenance :</span> {ORIGIN_LABEL[edge.data!.origin]}</p>
              <Button size="sm" variant="outline" className="w-full gap-1.5 text-destructive" onClick={deleteSelection}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer la relation</Button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
