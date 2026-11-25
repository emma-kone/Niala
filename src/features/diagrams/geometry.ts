import type { Diagram, DiagramAttribute, DiagramNode } from "@/server/domain/diagram";

// Dimensions calculées à partir du texte : l'affichage, les liens et la proposition de l'IA partagent la même géométrie.

export const ROW = 18;
export const HEAD = 30;
export const PAD = 8;
const CHAR = 7.1;
const TITLE_CHAR = 8.4;

export interface Size {
  w: number;
  h: number;
}

export function attrLabel(a: DiagramAttribute, kind: Diagram["kind"]): string {
  if (kind === "uml") return `${a.visibility ?? ""} ${a.name}${a.type ? ` : ${a.type}` : ""}`.trim();
  return a.name;
}

export function wrapText(text: string, max = 28): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > max && line) {
        out.push(line);
        line = word;
      } else line = (line + " " + word).trim();
    }
    out.push(line);
  }
  return out.slice(0, 14);
}

export function stereoHead(n: DiagramNode) {
  return n.stereotype ? HEAD + 14 : HEAD;
}

export function nodeSize(n: DiagramNode, kind: Diagram["kind"]): Size {
  if (n.type === "note") {
    const lines = wrapText(n.text || n.name);
    return { w: 200, h: Math.max(48, lines.length * 16 + 18) };
  }
  const labels = n.attributes.map((a) => attrLabel(a, kind));
  const longest = Math.max(n.name.length * TITLE_CHAR, ...labels.map((l) => l.length * CHAR), ...n.methods.map((m) => m.length * CHAR), (n.stereotype?.length ?? 0) * CHAR + 20);
  if (n.type === "class") {
    const attrsH = Math.max(1, n.attributes.length) * ROW + PAD;
    const methodsH = Math.max(1, n.methods.length) * ROW + PAD;
    return { w: Math.max(160, Math.ceil(longest + 28)), h: stereoHead(n) + attrsH + methodsH };
  }
  if (n.type === "association") {
    return { w: Math.max(130, Math.ceil(longest + 44)), h: HEAD + (n.attributes.length ? n.attributes.length * ROW + PAD : 6) };
  }
  return { w: Math.max(150, Math.ceil(longest + 28)), h: HEAD + Math.max(1, n.attributes.length) * ROW + PAD };
}

export interface Point {
  x: number;
  y: number;
}

/** Point du bord du rectangle (x, y, w, h) sur la droite qui va de son centre vers `toward`. */
export function borderPoint(x: number, y: number, s: Size, toward: Point): Point {
  const cx = x + s.w / 2;
  const cy = y + s.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const t = Math.min(Math.abs(s.w / 2 / (dx || 1e-9)), Math.abs(s.h / 2 / (dy || 1e-9)));
  return { x: cx + dx * t, y: cy + dy * t };
}

export function center(n: DiagramNode, s: Size): Point {
  return { x: n.x + s.w / 2, y: n.y + s.h / 2 };
}

/** Position d'une étiquette près d'une extrémité : un peu le long du lien, un peu sur le côté. */
export function labelNear(a: Point, b: Point, along = 22, side = 11): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { x: a.x + ux * along - uy * side, y: a.y + uy * along + ux * side };
}

export function bounds(d: Diagram): { x: number; y: number; w: number; h: number } | null {
  if (!d.nodes.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of d.nodes) {
    const s = nodeSize(n, d.kind);
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + s.w);
    maxY = Math.max(maxY, n.y + s.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

let counter = 0;
export function newId(prefix: string, d: Diagram): string {
  const used = new Set([...d.nodes.map((n) => n.id), ...d.links.map((l) => l.id)]);
  for (;;) {
    const id = `${prefix}${Date.now().toString(36).slice(-4)}${(counter++).toString(36)}`;
    if (!used.has(id)) return id;
  }
}
