"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Background, ConnectionMode, Controls, Handle, MarkerType, MiniMap, Panel, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Connection, type Edge, type Node, type NodeChange, type NodeProps } from "@xyflow/react";
import { Plus, Trash2 } from "lucide-react";
import { useTheme } from "@/components/theme/theme-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARDINALITIES, newId, type Association, type Cardinality, type Entity, type MeriseWork } from "@/workspaces/merise/model";

// ─────────────────────────────────────────────────────────────────────────────
// Éditeurs graphiques de l'atelier Merise : MCD (entités, associations, cardinalités) et diagramme générique
// (MCT, graphe des flux). Les positions sont enregistrées avec le modèle ; le dessin n'est jamais une image.
// ─────────────────────────────────────────────────────────────────────────────

type Pos = Record<string, { x: number; y: number }>;

/** Emplacement d'un nouvel élément : sous la barre d'outils, en grille, jamais empilé sur un autre. */
const slot = (n: number) => ({ x: 40 + (n % 3) * 260, y: 100 + Math.floor(n / 3) * 170 });

/** Recentre la vue quand un élément est ajouté ou retiré. */
function useRefit(count: number) {
  const rf = useReactFlow();
  useEffect(() => {
    const t = setTimeout(() => void rf.fitView({ padding: 0.3, duration: 200, maxZoom: 1 }), 60);
    return () => clearTimeout(t);
  }, [count, rf]);
}
const H = "!h-2.5 !w-2.5";

function Handles() {
  return (
    <>
      <Handle id="l" type="source" position={Position.Left} className={H} />
      <Handle id="r" type="source" position={Position.Right} className={H} />
      <Handle id="t" type="source" position={Position.Top} className={H} />
      <Handle id="b" type="source" position={Position.Bottom} className={H} />
    </>
  );
}

function EntityNode({ data, selected }: NodeProps<Node<{ name: string; attrs: { name: string; isId: boolean }[] }>>) {
  return (
    <div className={cn("min-w-36 rounded-md border-2 border-primary bg-card text-sm shadow-sm", selected && "ring-2 ring-primary")}>
      <Handles />
      <div className="border-b border-primary/40 bg-primary/10 px-2 py-1 text-center font-semibold">{data.name || "Entité"}</div>
      <ul className="space-y-0.5 px-2 py-1.5">
        {data.attrs.length === 0 && <li className="text-xs italic text-muted-foreground">Aucune propriété</li>}
        {data.attrs.map((a, i) => <li key={i} className={cn("text-xs", a.isId && "font-semibold underline")}>{a.name || "…"}</li>)}
      </ul>
    </div>
  );
}
function AssociationNode({ data, selected }: NodeProps<Node<{ name: string; attrs: string[] }>>) {
  return (
    <div className={cn("min-w-24 rounded-[2rem] border-2 border-amber-500 bg-amber-50 px-3 py-2 text-center text-sm shadow-sm dark:bg-amber-950/30", selected && "ring-2 ring-primary")}>
      <Handles />
      <p className="font-semibold">{data.name || "Association"}</p>
      {data.attrs.length > 0 && <ul className="mt-1 border-t border-amber-500/40 pt-1 text-[11px]">{data.attrs.map((a, i) => <li key={i}>{a || "…"}</li>)}</ul>}
    </div>
  );
}
const mcdNodeTypes = { entity: EntityNode, association: AssociationNode };

type Sel = { kind: "entity" | "association"; id: string } | null;

export function McdEditor({ work, update, disabled }: { work: MeriseWork; update: (fn: (w: MeriseWork) => MeriseWork) => void; disabled?: boolean }) {
  return (
    <ReactFlowProvider>
      <McdInner work={work} update={update} disabled={disabled} />
    </ReactFlowProvider>
  );
}

function McdInner({ work, update, disabled }: { work: MeriseWork; update: (fn: (w: MeriseWork) => MeriseWork) => void; disabled?: boolean }) {
  const { resolvedTheme } = useTheme();
  const [sel, setSel] = useState<Sel>(null);
  const [drag, setDrag] = useState<Pos>({});
  /** Tailles mesurées par React Flow : sans elles, un nœud contrôlé reste invisible. */
  const [size, setSize] = useState<Record<string, { width: number; height: number }>>({});
  const { entities, associations } = work.mcd;
  useRefit(entities.length + associations.length);

  const nodes = useMemo<Node[]>(
    () => [
      ...entities.map((e) => ({ id: e.id, type: "entity", measured: size[e.id], position: drag[e.id] ?? { x: e.x, y: e.y }, data: { name: e.name, attrs: e.attributes.map((a) => ({ name: a.name, isId: a.isId })) }, selected: sel?.id === e.id })),
      ...associations.map((a) => ({ id: a.id, type: "association", measured: size[a.id], position: drag[a.id] ?? { x: a.x, y: a.y }, data: { name: a.name, attrs: a.attributes.map((x) => x.name) }, selected: sel?.id === a.id })),
    ],
    [entities, associations, drag, size, sel],
  );
  const edges = useMemo<Edge[]>(
    () => associations.flatMap((a) => a.links.filter((l) => entities.some((e) => e.id === l.entityId)).map((l) => ({ id: l.id, source: a.id, target: l.entityId, sourceHandle: "r", targetHandle: "l", label: l.card, labelStyle: { fontSize: 12, fontWeight: 600 }, markerEnd: { type: MarkerType.ArrowClosed } }))),
    [associations, entities],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setSize((s) => {
        let next = s;
        for (const c of changes) if (c.type === "dimensions" && c.dimensions && (s[c.id]?.width !== c.dimensions.width || s[c.id]?.height !== c.dimensions.height)) next = { ...next, [c.id]: c.dimensions };
        return next;
      });
      if (disabled) return;
      setDrag((d) => {
        const next = { ...d };
        for (const c of changes) if (c.type === "position" && c.position) next[c.id] = c.position;
        return next;
      });
    },
    [disabled],
  );
  const commitDrag = useCallback(
    (_: unknown, node: Node) => {
      const p = drag[node.id] ?? node.position;
      update((w) => ({ ...w, mcd: { entities: w.mcd.entities.map((e) => (e.id === node.id ? { ...e, x: Math.round(p.x), y: Math.round(p.y) } : e)), associations: w.mcd.associations.map((a) => (a.id === node.id ? { ...a, x: Math.round(p.x), y: Math.round(p.y) } : a)) } }));
      setDrag((d) => { const n = { ...d }; delete n[node.id]; return n; });
    },
    [drag, update],
  );
  const onConnect = useCallback(
    (c: Connection) => {
      if (disabled || !c.source || !c.target) return;
      const assoc = associations.find((a) => a.id === c.source) ?? associations.find((a) => a.id === c.target);
      const entityId = assoc?.id === c.source ? c.target : c.source;
      if (!assoc || !entities.some((e) => e.id === entityId) || assoc.links.length >= 6) return;
      update((w) => ({ ...w, mcd: { ...w.mcd, associations: w.mcd.associations.map((a) => (a.id === assoc.id ? { ...a, links: [...a.links, { id: newId("l"), entityId, card: "0,N" as Cardinality }] } : a)) } }));
    },
    [associations, entities, update, disabled],
  );

  const spot = () => slot(entities.length + associations.length);
  const addEntity = () => {
    const e: Entity = { id: newId("e"), name: `Entité${entities.length + 1}`, ...spot(), attributes: [{ id: newId("a"), name: "id", isId: true }] };
    update((w) => ({ ...w, mcd: { ...w.mcd, entities: [...w.mcd.entities, e] } }));
    setSel({ kind: "entity", id: e.id });
  };
  const addAssociation = () => {
    const a: Association = { id: newId("s"), name: "", ...spot(), attributes: [], links: [] };
    update((w) => ({ ...w, mcd: { ...w.mcd, associations: [...w.mcd.associations, a] } }));
    setSel({ kind: "association", id: a.id });
  };
  const remove = () => {
    if (!sel) return;
    update((w) => ({
      ...w,
      mcd: sel.kind === "entity" ? { entities: w.mcd.entities.filter((e) => e.id !== sel.id), associations: w.mcd.associations.map((a) => ({ ...a, links: a.links.filter((l) => l.entityId !== sel.id) })) } : { ...w.mcd, associations: w.mcd.associations.filter((a) => a.id !== sel.id) },
    }));
    setSel(null);
  };

  const entity = sel?.kind === "entity" ? entities.find((e) => e.id === sel.id) : undefined;
  const assoc = sel?.kind === "association" ? associations.find((a) => a.id === sel.id) : undefined;
  const patchEntity = (id: string, f: (e: Entity) => Entity) => update((w) => ({ ...w, mcd: { ...w.mcd, entities: w.mcd.entities.map((e) => (e.id === id ? f(e) : e)) } }));
  const patchAssoc = (id: string, f: (a: Association) => Association) => update((w) => ({ ...w, mcd: { ...w.mcd, associations: w.mcd.associations.map((a) => (a.id === id ? f(a) : a)) } }));

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="h-[420px] overflow-hidden rounded-xl border" aria-label="Modèle conceptuel de données">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={mcdNodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={commitDrag}
          onConnect={onConnect}
          connectionMode={ConnectionMode.Loose}
          onNodeClick={(_, n) => setSel({ kind: n.type === "entity" ? "entity" : "association", id: n.id })}
          onEdgeClick={(_, e) => { const a = associations.find((x) => x.links.some((l) => l.id === e.id)); if (a) setSel({ kind: "association", id: a.id }); }}
          onPaneClick={() => setSel(null)}
          nodesConnectable={!disabled}
          nodesDraggable={!disabled}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          colorMode={resolvedTheme === "dark" ? "dark" : "light"}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} aria-label="Zoom et vue" />
          <MiniMap pannable zoomable className="!hidden sm:!block" />
          {!disabled && (
            <Panel position="top-left" className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={addEntity} className="gap-1.5"><Plus className="h-4 w-4" aria-hidden /> Entité</Button>
              <Button size="sm" variant="outline" onClick={addAssociation} className="gap-1.5 bg-background"><Plus className="h-4 w-4" aria-hidden /> Association</Button>
              <Button size="sm" variant="outline" onClick={remove} disabled={!sel} className="gap-1.5 bg-background"><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>
            </Panel>
          )}
        </ReactFlow>
      </div>

      <aside aria-label="Propriétés de l'élément" className="space-y-3 rounded-xl border bg-card p-3 text-sm">
        {!entity && !assoc && <p className="text-muted-foreground">Ajoutez une entité ou une association, puis sélectionnez-la pour la décrire. Pour relier : tirez d&apos;une association vers une entité, ou utilisez le panneau.</p>}
        {entity && (
          <fieldset disabled={disabled} className="space-y-2">
            <Label htmlFor="ent-name">Nom de l&apos;entité</Label>
            <Input id="ent-name" value={entity.name} maxLength={60} onChange={(e) => patchEntity(entity.id, (x) => ({ ...x, name: e.target.value }))} />
            <p className="text-xs font-medium">Propriétés <span className="font-normal text-muted-foreground">(case : identifiant)</span></p>
            {entity.attributes.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5">
                <input type="checkbox" aria-label={`${a.name || "Propriété"} : identifiant`} checked={a.isId} onChange={(e) => patchEntity(entity.id, (x) => ({ ...x, attributes: x.attributes.map((y) => (y.id === a.id ? { ...y, isId: e.target.checked } : y)) }))} />
                <Input aria-label="Nom de la propriété" value={a.name} maxLength={60} className="h-8" onChange={(e) => patchEntity(entity.id, (x) => ({ ...x, attributes: x.attributes.map((y) => (y.id === a.id ? { ...y, name: e.target.value } : y)) }))} />
                <button type="button" aria-label="Supprimer la propriété" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => patchEntity(entity.id, (x) => ({ ...x, attributes: x.attributes.filter((y) => y.id !== a.id) }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={entity.attributes.length >= 40} onClick={() => patchEntity(entity.id, (x) => ({ ...x, attributes: [...x.attributes, { id: newId("a"), name: "", isId: false }] }))}><Plus className="h-3.5 w-3.5" aria-hidden /> Propriété</Button>
          </fieldset>
        )}
        {assoc && (
          <fieldset disabled={disabled} className="space-y-2">
            <Label htmlFor="as-name">Nom de l&apos;association</Label>
            <Input id="as-name" value={assoc.name} maxLength={60} placeholder="Un verbe : passer, contenir…" onChange={(e) => patchAssoc(assoc.id, (x) => ({ ...x, name: e.target.value }))} />
            <p className="text-xs font-medium">Entités reliées et cardinalités</p>
            {assoc.links.map((l) => (
              <div key={l.id} className="flex items-center gap-1.5">
                <Select value={l.entityId} onValueChange={(v) => patchAssoc(assoc.id, (x) => ({ ...x, links: x.links.map((y) => (y.id === l.id ? { ...y, entityId: v } : y)) }))}>
                  <SelectTrigger aria-label="Entité reliée" className="h-8 min-w-0 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{entities.map((e) => <SelectItem key={e.id} value={e.id}>{e.name || "(sans nom)"}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={l.card} onValueChange={(v) => patchAssoc(assoc.id, (x) => ({ ...x, links: x.links.map((y) => (y.id === l.id ? { ...y, card: v as Cardinality } : y)) }))}>
                  <SelectTrigger aria-label="Cardinalité" className="h-8 w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>{CARDINALITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <button type="button" aria-label="Retirer ce lien" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => patchAssoc(assoc.id, (x) => ({ ...x, links: x.links.filter((y) => y.id !== l.id) }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={entities.length === 0 || assoc.links.length >= 6} onClick={() => patchAssoc(assoc.id, (x) => ({ ...x, links: [...x.links, { id: newId("l"), entityId: entities[0].id, card: "0,N" }] }))}><Plus className="h-3.5 w-3.5" aria-hidden /> Relier une entité</Button>
            <p className="pt-1 text-xs font-medium">Propriétés de l&apos;association</p>
            {assoc.attributes.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5">
                <Input aria-label="Nom de la propriété" value={a.name} maxLength={60} className="h-8" onChange={(e) => patchAssoc(assoc.id, (x) => ({ ...x, attributes: x.attributes.map((y) => (y.id === a.id ? { ...y, name: e.target.value } : y)) }))} />
                <button type="button" aria-label="Supprimer la propriété" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => patchAssoc(assoc.id, (x) => ({ ...x, attributes: x.attributes.filter((y) => y.id !== a.id) }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={assoc.attributes.length >= 20} onClick={() => patchAssoc(assoc.id, (x) => ({ ...x, attributes: [...x.attributes, { id: newId("a"), name: "" }] }))}><Plus className="h-3.5 w-3.5" aria-hidden /> Propriété</Button>
          </fieldset>
        )}
      </aside>
    </div>
  );
}

// ── Diagramme générique : MCT (événements, opérations, résultats, synchronisations) et graphe des flux ──

export interface DiagramKind {
  value: string;
  label: string;
  className: string;
}
interface DNode {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
  rule?: string;
}
interface DEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

function DiagramNode({ data, selected }: NodeProps<Node<{ label: string; kind: string; kindLabel: string; className: string; rule?: string }>>) {
  return (
    <div className={cn("min-w-28 max-w-56 rounded-lg border-2 px-3 py-2 text-center text-sm shadow-sm", data.className, selected && "ring-2 ring-primary")}>
      <Handle type="target" position={Position.Left} className={H} />
      <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">{data.kindLabel}</p>
      <p className="font-medium leading-tight">{data.label || "…"}</p>
      {data.rule && <p className="mt-0.5 text-[11px] opacity-80">{data.rule}</p>}
      <Handle type="source" position={Position.Right} className={H} />
    </div>
  );
}
const diagramNodeTypes = { box: DiagramNode };

export function DiagramEditor(props: { nodes: DNode[]; edges: DEdge[]; kinds: DiagramKind[]; edgeLabels?: boolean; ruleField?: boolean; nodeWord: string; onChange: (nodes: DNode[], edges: DEdge[]) => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <ReactFlowProvider>
      <DiagramInner {...props} />
    </ReactFlowProvider>
  );
}

function DiagramInner({ nodes: model, edges: links, kinds, edgeLabels, ruleField, nodeWord, onChange, disabled, ariaLabel }: Parameters<typeof DiagramEditor>[0]) {
  const { resolvedTheme } = useTheme();
  const [sel, setSel] = useState<{ type: "node" | "edge"; id: string } | null>(null);
  const [drag, setDrag] = useState<Pos>({});
  const [size, setSize] = useState<Record<string, { width: number; height: number }>>({});
  const kindOf = (k: string) => kinds.find((x) => x.value === k) ?? kinds[0];
  useRefit(model.length);

  const nodes = useMemo<Node[]>(() => model.map((n) => ({ id: n.id, type: "box", measured: size[n.id], position: drag[n.id] ?? { x: n.x, y: n.y }, selected: sel?.id === n.id, data: { label: n.label, kind: n.kind, kindLabel: kindOf(n.kind).label, className: kindOf(n.kind).className, rule: n.rule } })), [model, drag, size, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo<Edge[]>(() => links.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.label || undefined, selected: sel?.id === e.id, markerEnd: { type: MarkerType.ArrowClosed } })), [links, sel]);

  const patch = (id: string, f: Partial<DNode>) => onChange(model.map((n) => (n.id === id ? { ...n, ...f } : n)), links);
  const add = () => {
    const n: DNode = { id: newId("n"), label: "", kind: kinds[0].value, ...slot(model.length), ...(ruleField ? { rule: "" } : {}) };
    onChange([...model, n], links);
    setSel({ type: "node", id: n.id });
  };
  const remove = () => {
    if (!sel) return;
    if (sel.type === "node") onChange(model.filter((n) => n.id !== sel.id), links.filter((e) => e.from !== sel.id && e.to !== sel.id));
    else onChange(model, links.filter((e) => e.id !== sel.id));
    setSel(null);
  };
  const node = sel?.type === "node" ? model.find((n) => n.id === sel.id) : undefined;
  const edge = sel?.type === "edge" ? links.find((e) => e.id === sel.id) : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="h-[420px] overflow-hidden rounded-xl border" aria-label={ariaLabel}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={diagramNodeTypes}
          onNodesChange={(changes) => { setSize((s) => { let next = s; for (const c of changes) if (c.type === "dimensions" && c.dimensions && (s[c.id]?.width !== c.dimensions.width || s[c.id]?.height !== c.dimensions.height)) next = { ...next, [c.id]: c.dimensions }; return next; }); if (!disabled) setDrag((d) => { const next = { ...d }; for (const c of changes) if (c.type === "position" && c.position) next[c.id] = c.position; return next; }); }}
          onNodeDragStop={(_, n) => { const p = drag[n.id] ?? n.position; patch(n.id, { x: Math.round(p.x), y: Math.round(p.y) }); setDrag((d) => { const x = { ...d }; delete x[n.id]; return x; }); }}
          onConnect={(c: Connection) => { if (!disabled && c.source && c.target && c.source !== c.target && !links.some((e) => e.from === c.source && e.to === c.target)) onChange(model, [...links, { id: newId("l"), from: c.source, to: c.target, ...(edgeLabels ? { label: "" } : {}) }]); }}
          onNodeClick={(_, n) => setSel({ type: "node", id: n.id })}
          onEdgeClick={(_, e) => setSel({ type: "edge", id: e.id })}
          onPaneClick={() => setSel(null)}
          connectionMode={ConnectionMode.Loose}
          nodesConnectable={!disabled}
          nodesDraggable={!disabled}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={2}
          colorMode={resolvedTheme === "dark" ? "dark" : "light"}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} aria-label="Zoom et vue" />
          {!disabled && (
            <Panel position="top-left" className="flex gap-1.5">
              <Button size="sm" onClick={add} className="gap-1.5"><Plus className="h-4 w-4" aria-hidden /> {nodeWord}</Button>
              <Button size="sm" variant="outline" onClick={remove} disabled={!sel} className="gap-1.5 bg-background"><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>
            </Panel>
          )}
        </ReactFlow>
      </div>
      <aside aria-label="Propriétés de l'élément" className="space-y-2 rounded-xl border bg-card p-3 text-sm">
        {!node && !edge && <p className="text-muted-foreground">Ajoutez des éléments, puis reliez-les en tirant d&apos;une poignée à l&apos;autre. Sélectionnez un élément ou un lien pour le décrire.</p>}
        {node && (
          <fieldset disabled={disabled} className="space-y-2">
            <Label htmlFor="dg-label">Libellé</Label>
            <Input id="dg-label" value={node.label} maxLength={120} onChange={(e) => patch(node.id, { label: e.target.value })} />
            <Label>Type</Label>
            <Select value={node.kind} onValueChange={(v) => patch(node.id, { kind: v })}>
              <SelectTrigger aria-label="Type d'élément" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{kinds.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
            </Select>
            {ruleField && (<><Label htmlFor="dg-rule">Règle ou condition</Label><Input id="dg-rule" value={node.rule ?? ""} maxLength={200} onChange={(e) => patch(node.id, { rule: e.target.value })} /></>)}
          </fieldset>
        )}
        {edge && (
          <fieldset disabled={disabled} className="space-y-2">
            {edgeLabels ? (<><Label htmlFor="dg-edge">Information échangée</Label><Input id="dg-edge" value={edge.label ?? ""} maxLength={120} onChange={(e) => onChange(model, links.map((x) => (x.id === edge.id ? { ...x, label: e.target.value } : x)))} /></>) : <p className="text-muted-foreground">Lien de déclenchement.</p>}
          </fieldset>
        )}
      </aside>
    </div>
  );
}
