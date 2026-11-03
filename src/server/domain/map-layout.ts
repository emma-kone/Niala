// Disposition automatique des cartes (pure, partagée serveur/client).
//  - arbre : plan hiérarchique, relations « fait partie de » orientées enfant → parent ;
//  - couches : carte conceptuelle, rang = longueur de la plus longue chaîne de prérequis.

export interface LayoutNode {
  id: string;
}
export interface LayoutEdge {
  source: string;
  target: string;
  type: string;
}
export type Positions = Record<string, { x: number; y: number }>;

const X_STEP = 280;
const Y_STEP = 64;

/** Arbre horizontal : la racine à gauche, les enfants à droite, parents centrés sur leurs enfants. */
export function layoutTree(nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
  const ids = new Set(nodes.map((n) => n.id));
  const parentOf = new Map<string, string>();
  for (const e of edges) {
    if (e.type === "PART_OF" && ids.has(e.source) && ids.has(e.target) && e.source !== e.target && !parentOf.has(e.source)) parentOf.set(e.source, e.target);
  }
  // casse les cycles éventuels
  for (const n of nodes) {
    const seen = new Set<string>([n.id]);
    let cur = parentOf.get(n.id);
    while (cur) {
      if (seen.has(cur)) {
        parentOf.delete(n.id);
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    const p = parentOf.get(n.id);
    if (p) children.set(p, [...(children.get(p) ?? []), n.id]);
  }
  const pos: Positions = {};
  let nextLeaf = 0;
  const place = (id: string, depth: number): number => {
    const kids = children.get(id) ?? [];
    let y: number;
    if (kids.length === 0) y = nextLeaf++ * Y_STEP;
    else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos[id] = { x: depth * X_STEP, y };
    return y;
  };
  for (const n of nodes) if (!parentOf.has(n.id)) place(n.id, 0);
  return pos;
}

/** Couches : les prérequis à gauche. Les notions sans relation sont rangées en grille sous le graphe. */
export function layoutLayers(nodes: LayoutNode[], edges: LayoutEdge[]): Positions {
  const ids = new Set(nodes.map((n) => n.id));
  const prereq = edges.filter((e) => e.type === "PREREQUISITE" && ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const connected = new Set<string>();
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) (connected.add(e.source), connected.add(e.target));

  const rank = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const e of prereq) incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (visiting.has(id)) return 0; // cycle : on ne descend pas
    visiting.add(id);
    const r = Math.max(-1, ...(incoming.get(id) ?? []).map(rankOf)) + 1;
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  const layers = new Map<number, string[]>();
  for (const n of nodes) {
    if (!connected.has(n.id)) continue;
    const r = rankOf(n.id);
    layers.set(r, [...(layers.get(r) ?? []), n.id]);
  }
  const pos: Positions = {};
  let maxRows = 0;
  for (const [r, list] of layers) {
    list.forEach((id, i) => (pos[id] = { x: r * X_STEP, y: i * (Y_STEP + 16) }));
    maxRows = Math.max(maxRows, list.length);
  }
  // notions isolées : grille de 4 colonnes sous le graphe
  const isolated = nodes.filter((n) => !connected.has(n.id));
  const top = connected.size ? (maxRows + 1) * (Y_STEP + 16) : 0;
  isolated.forEach((n, i) => (pos[n.id] = { x: (i % 4) * 240, y: top + Math.floor(i / 4) * (Y_STEP + 8) }));
  return pos;
}
