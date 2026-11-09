import { z } from "zod";
import { groundedRatio } from "@/server/ai/guard";

// ─────────────────────────────────────────────────────────────────────────────
// Carte mentale proposée par l'IA : le serveur ne retient que ce qui forme un arbre cohérent.
// Une seule racine, aucun cycle, aucun parent inconnu, pas de doublon ; la provenance de chaque nœud (présent dans
// le texte ou déduit) est calculée ici, jamais déclarée par le modèle.
// ─────────────────────────────────────────────────────────────────────────────

export const NODE_KINDS = ["theme", "chapter", "concept", "definition", "formula", "method", "example"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

const LINK_TYPES = ["PREREQUISITE", "EXAMPLE_OF", "CONTRASTS", "DEFINES", "RELATED"] as const;
export const MAX_DEPTH = 6;
export const MAX_LINKS = 30;
const GROUNDED_MIN = 0.34;

export const rawMindMapSchema = z.object({
  title: z.string().trim().min(2).max(120),
  nodes: z
    .array(
      z.object({
        id: z.coerce.string().min(1).max(30),
        label: z.string().trim().min(1).max(80),
        parent: z.coerce.string().nullable().optional().catch(null),
        kind: z.enum(NODE_KINDS).catch("concept"),
        detail: z.string().trim().max(500).optional().catch(undefined),
        page: z.number().int().positive().optional().catch(undefined),
      }),
    )
    .min(3)
    .max(150),
  links: z
    .array(z.object({ from: z.coerce.string(), to: z.coerce.string(), type: z.enum(LINK_TYPES).catch("RELATED"), label: z.string().trim().max(60).optional().catch(undefined) }))
    .max(60)
    .catch([]),
});
export type RawMindMap = z.infer<typeof rawMindMapSchema>;

export interface BuiltNode {
  key: string;
  label: string;
  parent: string | null;
  depth: number;
  kind: NodeKind;
  detail?: string;
  page?: number;
  origin: "DOCUMENT" | "AI_INFERRED";
}
export interface BuiltLink {
  from: string;
  to: string;
  type: (typeof LINK_TYPES)[number];
  label?: string;
}
export interface BuiltMindMap {
  title: string;
  nodes: BuiltNode[];
  links: BuiltLink[];
  /** Éléments écartés lors du contrôle (parent inconnu, doublon, cycle…). */
  repairs: number;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function buildMindMap(raw: RawMindMap, source: string, fallbackTitle: string): BuiltMindMap {
  let repairs = 0;
  // Identifiants uniques
  const seen = new Set<string>();
  const nodes = raw.nodes.filter((n) => (seen.has(n.id) ? (repairs++, false) : (seen.add(n.id), true)));
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Racine : le premier nœud sans parent valide ; les autres racines deviennent ses enfants. Sans racine, on en crée une.
  const roots = nodes.filter((n) => !n.parent || !byId.has(n.parent) || n.parent === n.id);
  const rootKey = roots[0]?.id ?? "__root";
  const parentOf = new Map<string, string>();
  for (const n of nodes) {
    if (n.id === rootKey) continue;
    const p = n.parent && byId.has(n.parent) && n.parent !== n.id ? n.parent : rootKey;
    if (p !== n.parent) repairs++;
    parentOf.set(n.id, p);
  }
  // Cycles : tout nœud qui ne remonte pas à la racine y est rattaché directement.
  for (const n of nodes) {
    const trail = new Set<string>([n.id]);
    let cur = parentOf.get(n.id);
    while (cur && cur !== rootKey) {
      if (trail.has(cur)) {
        parentOf.set(n.id, rootKey);
        repairs++;
        break;
      }
      trail.add(cur);
      cur = parentOf.get(cur);
    }
  }
  const depthOf = (id: string): number => {
    let d = 0;
    for (let cur = parentOf.get(id); cur; cur = parentOf.get(cur)) d++;
    return d;
  };
  // Pas deux frères de même intitulé ; profondeur bornée (lisibilité).
  const siblingLabels = new Set<string>();
  const kept: BuiltNode[] = [];
  const text = source.length > 0 ? source : "";
  const all = rootKey === "__root" ? [{ id: "__root", label: raw.title.slice(0, 80) || fallbackTitle.slice(0, 80), parent: null, kind: "theme" as NodeKind, detail: undefined, page: undefined }, ...nodes] : nodes;
  for (const n of all) {
    const parent = n.id === rootKey ? null : parentOf.get(n.id)!;
    const dup = `${parent}|${norm(n.label)}`;
    if (parent !== null && siblingLabels.has(dup)) {
      repairs++;
      continue;
    }
    siblingLabels.add(dup);
    let depth = parent === null ? 0 : depthOf(n.id) + (rootKey === "__root" ? 0 : 0);
    let p = parent;
    if (depth > MAX_DEPTH) {
      repairs++;
      while (p && depthOf(p) >= MAX_DEPTH) p = parentOf.get(p) ?? rootKey;
      depth = MAX_DEPTH;
    }
    const grounded = text ? groundedRatio(`${n.label} ${n.detail ?? ""}`, text) >= GROUNDED_MIN : false;
    kept.push({ key: n.id, label: n.label, parent: p, depth, kind: n.kind, detail: n.detail, page: n.page, origin: grounded ? "DOCUMENT" : "AI_INFERRED" });
  }
  // Un parent écarté (doublon) ne doit pas laisser d'orphelin.
  const keys = new Set(kept.map((n) => n.key));
  for (const n of kept) if (n.parent && !keys.has(n.parent)) n.parent = rootKey === "__root" ? "__root" : rootKey;

  // Liens transversaux : nœuds connus, pas de lien parent-enfant redondant, pas de doublon
  const edges = new Set(kept.filter((n) => n.parent).map((n) => `${n.key}|${n.parent}`));
  const linkSeen = new Set<string>();
  const links: BuiltLink[] = [];
  for (const l of raw.links) {
    const k = `${l.from}|${l.to}|${l.type}`;
    if (!keys.has(l.from) || !keys.has(l.to) || l.from === l.to || edges.has(`${l.from}|${l.to}`) || edges.has(`${l.to}|${l.from}`) || linkSeen.has(k)) {
      repairs++;
      continue;
    }
    linkSeen.add(k);
    links.push(l);
    if (links.length >= MAX_LINKS) break;
  }
  return { title: raw.title, nodes: kept, links, repairs };
}
