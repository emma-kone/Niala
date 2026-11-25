"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Diagram, DiagramLink, DiagramNode } from "@/server/domain/diagram";
import { attrLabel, borderPoint, bounds, center, HEAD, labelNear, nodeSize, PAD, ROW, stereoHead, wrapText, type Point } from "./geometry";

// Canevas SVG de l'éditeur : déplacement des éléments, sélection, déplacement de la vue (glisser le fond),
// zoom (Ctrl + molette ou boutons), et mode « relier » (cliquer la source puis la cible).

export type Tool = "select" | "link";

export interface CanvasHandle {
  fit: () => void;
  zoomBy: (f: number) => void;
  /** Centre de la vue, en coordonnées du diagramme : là où placer un nouvel élément. */
  viewCenter: () => Point;
  svg: () => SVGSVGElement | null;
}

interface Props {
  diagram: Diagram;
  selection: string[];
  tool: Tool;
  linkFrom: string | null;
  onSelect: (ids: string[]) => void;
  /** Déplacement en cours (pas d'entrée d'historique à chaque pixel). */
  onMove: (positions: Record<string, Point>, commit: boolean) => void;
  onLinkClick: (nodeId: string) => void;
  onOpen: (id: string) => void;
  /** Cadrage de départ (zoom et position) : celui que l'étudiant avait en quittant le diagramme. */
  initialView?: View | null;
  onViewChange?: (v: View) => void;
}

export type View = { x: number; y: number; k: number };

const STROKE = "var(--foreground)";
const MUTED = "var(--muted-foreground)";
const SELECT = "var(--primary)";

export const DiagramCanvas = forwardRef<CanvasHandle, Props>(function DiagramCanvas({ diagram, selection, tool, linkFrom, onSelect, onMove, onLinkClick, onOpen, initialView, onViewChange }, ref) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(() => initialView ?? { x: -40, y: -40, k: 1 });
  const viewListener = useRef(onViewChange);
  viewListener.current = onViewChange;
  useEffect(() => {
    viewListener.current?.(view);
  }, [view]);
  const [box, setBox] = useState({ w: 1000, h: 600 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth || 1000, h: el.clientHeight || 600 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const drag = useRef<null | { kind: "nodes"; start: Point; origin: Record<string, Point>; moved: boolean } | { kind: "pan"; start: Point; origin: { x: number; y: number }; moved: boolean }>(null);

  const toDiagram = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = svgRef.current?.getBoundingClientRect();
      return { x: (clientX - (r?.left ?? 0)) / view.k + view.x, y: (clientY - (r?.top ?? 0)) / view.k + view.y };
    },
    [view]
  );

  useImperativeHandle(ref, () => ({
    fit() {
      const b = bounds(diagram);
      const r = svgRef.current?.getBoundingClientRect();
      if (!b || !r) return setView({ x: -40, y: -40, k: 1 });
      const k = Math.min(1.4, Math.max(0.25, Math.min(r.width / (b.w + 120), r.height / (b.h + 120))));
      setView({ x: b.x - (r.width / k - b.w) / 2, y: b.y - (r.height / k - b.h) / 2, k });
    },
    zoomBy(f: number) {
      const r = svgRef.current?.getBoundingClientRect();
      const cx = (r?.width ?? 800) / 2;
      const cy = (r?.height ?? 500) / 2;
      setView((v) => {
        const k = Math.min(3, Math.max(0.2, v.k * f));
        return { k, x: v.x + cx / v.k - cx / k, y: v.y + cy / v.k - cy / k };
      });
    },
    viewCenter() {
      const r = svgRef.current?.getBoundingClientRect();
      return { x: view.x + (r?.width ?? 800) / 2 / view.k, y: view.y + (r?.height ?? 500) / 2 / view.k };
    },
    svg: () => svgRef.current,
  }));

  const sizes = new Map(diagram.nodes.map((n) => [n.id, nodeSize(n, diagram.kind)]));
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));

  function onNodeDown(e: ReactPointerEvent, n: DiagramNode) {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (tool === "link") {
      onLinkClick(n.id);
      return;
    }
    let ids = selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) ids = selection.includes(n.id) ? selection.filter((s) => s !== n.id) : [...selection, n.id];
    else if (!selection.includes(n.id)) ids = [n.id];
    onSelect(ids);
    const origin: Record<string, Point> = {};
    for (const id of ids) {
      const m = byId.get(id);
      if (m) origin[id] = { x: m.x, y: m.y };
    }
    drag.current = { kind: "nodes", start: toDiagram(e.clientX, e.clientY), origin, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function onBackgroundDown(e: ReactPointerEvent) {
    if (e.button !== 0) return;
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) onSelect([]);
    drag.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, origin: { x: view.x, y: view.y }, moved: false };
    svgRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      d.moved = true;
      setView((v) => ({ ...v, x: d.origin.x - (e.clientX - d.start.x) / v.k, y: d.origin.y - (e.clientY - d.start.y) / v.k }));
      return;
    }
    const p = toDiagram(e.clientX, e.clientY);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 2) return;
    d.moved = true;
    const next: Record<string, Point> = {};
    for (const [id, o] of Object.entries(d.origin)) next[id] = { x: Math.round(o.x + dx), y: Math.round(o.y + dy) };
    onMove(next, false);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "nodes" && d.moved) {
      const now: Record<string, Point> = {};
      for (const id of Object.keys(d.origin)) {
        const m = byId.get(id);
        if (m) now[id] = { x: m.x, y: m.y };
      }
      onMove(now, true);
    }
  }

  function onWheel(e: React.WheelEvent) {
    if (e.ctrlKey || e.metaKey) {
      const p = toDiagram(e.clientX, e.clientY);
      setView((v) => {
        const k = Math.min(3, Math.max(0.2, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
        return { k, x: p.x - (p.x - v.x) * (v.k / k), y: p.y - (p.y - v.y) * (v.k / k) };
      });
    } else {
      setView((v) => ({ ...v, x: v.x + e.deltaX / v.k, y: v.y + e.deltaY / v.k }));
    }
  }

  function renderLink(l: DiagramLink) {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b) return null;
    const sa = sizes.get(a.id)!;
    const sb = sizes.get(b.id)!;
    const ca = center(a, sa);
    const cb = center(b, sb);
    const pa = borderPoint(a.x, a.y, sa, cb);
    const pb = borderPoint(b.x, b.y, sb, ca);
    const selected = selection.includes(l.id);
    const marker = l.type === "inheritance" ? "url(#dg-triangle)" : l.type === "composition" ? "url(#dg-diamond-full)" : l.type === "aggregation" ? "url(#dg-diamond)" : l.type === "dependency" ? "url(#dg-arrow)" : undefined;
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    const from = labelNear(pa, pb);
    const to = labelNear(pb, pa);
    return (
      <g key={l.id} className="cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); if (tool === "select") onSelect(e.shiftKey ? [...selection, l.id] : [l.id]); }} onDoubleClick={() => onOpen(l.id)}>
        <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="transparent" strokeWidth={14} />
        <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={selected ? SELECT : STROKE} strokeWidth={selected ? 2.4 : 1.4} strokeDasharray={l.type === "dependency" ? "6 4" : undefined} markerEnd={marker} />
        {l.cardFrom && <text x={from.x} y={from.y} fontSize={12} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill={STROKE}>{l.cardFrom}</text>}
        {l.cardTo && <text x={to.x} y={to.y} fontSize={12} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill={STROKE}>{l.cardTo}</text>}
        {l.label && <text x={mid.x} y={mid.y - 7} fontSize={11} fontStyle="italic" textAnchor="middle" fill={MUTED}>{l.label}</text>}
      </g>
    );
  }

  function renderNode(n: DiagramNode) {
    const s = sizes.get(n.id)!;
    const selected = selection.includes(n.id);
    const isSource = linkFrom === n.id;
    const stroke = selected || isSource ? SELECT : STROKE;
    const sw = selected || isSource ? 2.4 : 1.4;
    const common = { onPointerDown: (e: ReactPointerEvent) => onNodeDown(e, n), onDoubleClick: () => onOpen(n.id), className: tool === "link" ? "cursor-crosshair" : "cursor-move" };
    if (n.type === "note") {
      const lines = wrapText(n.text || n.name);
      return (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
          <path d={`M0 0 H${s.w - 14} L${s.w} 14 V${s.h} H0 Z`} fill="#fef9c3" stroke={stroke} strokeWidth={sw} />
          <path d={`M${s.w - 14} 0 V14 H${s.w}`} fill="none" stroke={stroke} strokeWidth={1} />
          {lines.map((t, i) => <text key={i} x={10} y={20 + i * 16} fontSize={12} fill="#422006">{t}</text>)}
        </g>
      );
    }
    if (n.type === "association") {
      return (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
          <rect width={s.w} height={s.h} rx={Math.min(s.h / 2, 26)} fill="var(--card)" stroke={stroke} strokeWidth={sw} />
          <text x={s.w / 2} y={HEAD / 2 + 4} fontSize={13} fontWeight={700} textAnchor="middle" fill={STROKE}>{n.name}</text>
          {n.attributes.length > 0 && <line x1={10} x2={s.w - 10} y1={HEAD} y2={HEAD} stroke={MUTED} strokeWidth={1} />}
          {n.attributes.map((a, i) => <text key={i} x={s.w / 2} y={HEAD + 14 + i * ROW} fontSize={12} textAnchor="middle" fill={STROKE}>{a.name}</text>)}
        </g>
      );
    }
    if (n.type === "class") {
      const head = stereoHead(n);
      const attrsH = Math.max(1, n.attributes.length) * ROW + PAD;
      return (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
          <rect width={s.w} height={s.h} fill="var(--card)" stroke={stroke} strokeWidth={sw} />
          {n.stereotype && <text x={s.w / 2} y={15} fontSize={11} textAnchor="middle" fill={MUTED}>«{n.stereotype}»</text>}
          <text x={s.w / 2} y={head - 10} fontSize={13} fontWeight={700} fontStyle={n.stereotype === "abstract" ? "italic" : undefined} textAnchor="middle" fill={STROKE}>{n.name}</text>
          <line x1={0} x2={s.w} y1={head} y2={head} stroke={stroke} strokeWidth={1} />
          {n.attributes.map((a, i) => <text key={i} x={8} y={head + 14 + i * ROW} fontSize={12} fill={STROKE} textDecoration={a.key ? "underline" : undefined}>{attrLabel(a, "uml")}</text>)}
          <line x1={0} x2={s.w} y1={head + attrsH} y2={head + attrsH} stroke={stroke} strokeWidth={1} />
          {n.methods.map((m, i) => <text key={i} x={8} y={head + attrsH + 14 + i * ROW} fontSize={12} fill={STROKE}>{m}</text>)}
        </g>
      );
    }
    return (
      <g key={n.id} transform={`translate(${n.x},${n.y})`} {...common}>
        <rect width={s.w} height={s.h} rx={4} fill="var(--card)" stroke={stroke} strokeWidth={sw} />
        <rect width={s.w} height={HEAD} rx={4} fill="color-mix(in oklab, var(--primary) 14%, transparent)" />
        <text x={s.w / 2} y={HEAD / 2 + 5} fontSize={13} fontWeight={700} textAnchor="middle" fill={STROKE}>{n.name}</text>
        <line x1={0} x2={s.w} y1={HEAD} y2={HEAD} stroke={stroke} strokeWidth={1} />
        {n.attributes.length === 0 && <text x={10} y={HEAD + 14} fontSize={11} fontStyle="italic" fill={MUTED}>aucun attribut</text>}
        {n.attributes.map((a, i) => <text key={i} x={10} y={HEAD + 14 + i * ROW} fontSize={12} fontWeight={a.key ? 700 : 400} textDecoration={a.key ? "underline" : undefined} fill={STROKE}>{a.name}</text>)}
      </g>
    );
  }

  return (
    <svg
      ref={svgRef}
      role="application"
      aria-label={`Diagramme : ${diagram.nodes.length} élément(s), ${diagram.links.length} lien(s)`}
      className={`h-full w-full touch-none select-none bg-[radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:20px_20px] ${tool === "link" ? "cursor-crosshair" : "cursor-grab"}`}
      viewBox={`${view.x} ${view.y} ${box.w / view.k} ${box.h / view.k}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <defs>
        <marker id="dg-triangle" viewBox="0 0 12 12" refX={11} refY={6} markerWidth={14} markerHeight={14} orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0 0 L12 6 L0 12 Z" fill="var(--card)" stroke={STROKE} strokeWidth={1.2} />
        </marker>
        <marker id="dg-diamond" viewBox="0 0 16 10" refX={15} refY={5} markerWidth={18} markerHeight={12} orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0 5 L8 0 L16 5 L8 10 Z" fill="var(--card)" stroke={STROKE} strokeWidth={1.2} />
        </marker>
        <marker id="dg-diamond-full" viewBox="0 0 16 10" refX={15} refY={5} markerWidth={18} markerHeight={12} orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0 5 L8 0 L16 5 L8 10 Z" fill={STROKE} stroke={STROKE} strokeWidth={1.2} />
        </marker>
        <marker id="dg-arrow" viewBox="0 0 12 12" refX={11} refY={6} markerWidth={12} markerHeight={12} orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0 0 L12 6 L0 12" fill="none" stroke={STROKE} strokeWidth={1.4} />
        </marker>
      </defs>
      {diagram.links.map(renderLink)}
      {diagram.nodes.map(renderNode)}
    </svg>
  );
});
