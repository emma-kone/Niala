import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Modèle des diagrammes du laboratoire « Diagrammes » : MCD (Merise) et diagramme de classes UML.
// Partagé entre le serveur (validation, assistant IA) et l'éditeur : un seul format, toujours validé.
//  - MCD : des entités et des associations (qui peuvent porter des attributs), reliées par des pattes
//    portant la cardinalité côté entité (0,1 · 1,1 · 0,n · 1,n).
//  - UML : des classes (attributs, opérations), reliées par association, héritage, composition,
//    agrégation ou dépendance, avec multiplicités aux deux extrémités.
// Des notes libres peuvent s'ajouter dans les deux cas.
// ─────────────────────────────────────────────────────────────────────────────

export const DIAGRAM_KINDS = { mcd: "MCD (Merise)", uml: "Diagramme de classes UML" } as const;
export type DiagramKind = keyof typeof DIAGRAM_KINDS;

export const MCD_CARDINALITIES = ["0,1", "1,1", "0,n", "1,n"] as const;
export const UML_MULTIPLICITIES = ["1", "0..1", "*", "0..*", "1..*"] as const;
export const UML_LINK_TYPES = { association: "Association", inheritance: "Héritage", composition: "Composition", aggregation: "Agrégation", dependency: "Dépendance" } as const;
export type UmlLinkType = keyof typeof UML_LINK_TYPES;

export const MAX_NODES = 150;
export const MAX_LINKS = 300;
const MAX_ATTRS = 40;

const name = z.string().trim().min(1).max(80);
const coord = z.number().finite().min(-20_000).max(20_000);

export const attributeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().max(40).optional(),
  /** Identifiant (MCD) ou attribut clé : souligné. */
  key: z.boolean().optional(),
  /** Visibilité UML : + publique, - privée, # protégée, ~ paquet. */
  visibility: z.enum(["+", "-", "#", "~"]).optional(),
});

export const nodeSchema = z.object({
  id: z.string().trim().min(1).max(40),
  type: z.enum(["entity", "association", "class", "note"]),
  name,
  x: coord,
  y: coord,
  attributes: z.array(attributeSchema).max(MAX_ATTRS).default([]),
  /** Opérations d'une classe UML, écrites librement (ex. « + calculerTotal() : float »). */
  methods: z.array(z.string().trim().min(1).max(120)).max(MAX_ATTRS).default([]),
  /** Stéréotype UML (« abstract », « interface »…) ou texte d'une note. */
  stereotype: z.string().trim().max(40).optional(),
  text: z.string().max(1000).optional(),
});

export const linkSchema = z.object({
  id: z.string().trim().min(1).max(40),
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  /** MCD : « mcd » (patte entité–association). UML : type de relation. */
  type: z.enum(["mcd", "association", "inheritance", "composition", "aggregation", "dependency"]),
  /** Cardinalité ou multiplicité à l'extrémité « from » / « to ». */
  cardFrom: z.string().trim().max(12).optional(),
  cardTo: z.string().trim().max(12).optional(),
  label: z.string().trim().max(80).optional(),
});

export const diagramSchema = z.object({
  kind: z.enum(["mcd", "uml"]),
  nodes: z.array(nodeSchema).max(MAX_NODES),
  links: z.array(linkSchema).max(MAX_LINKS),
});

export type DiagramAttribute = z.infer<typeof attributeSchema>;
export type DiagramNode = z.infer<typeof nodeSchema>;
export type DiagramLink = z.infer<typeof linkSchema>;
export type Diagram = z.infer<typeof diagramSchema>;

export function emptyDiagram(kind: DiagramKind): Diagram {
  return { kind, nodes: [], links: [] };
}

/** Exemple de départ, pour que la page ne soit pas vide et montre la notation. */
export function starterDiagram(kind: DiagramKind): Diagram {
  if (kind === "mcd") {
    return {
      kind,
      nodes: [
        { id: "e1", type: "entity", name: "ÉTUDIANT", x: 60, y: 80, attributes: [{ name: "numEtudiant", key: true }, { name: "nom" }, { name: "prénom" }], methods: [] },
        { id: "a1", type: "association", name: "S'INSCRIRE", x: 330, y: 100, attributes: [{ name: "dateInscription" }], methods: [] },
        { id: "e2", type: "entity", name: "COURS", x: 580, y: 80, attributes: [{ name: "codeCours", key: true }, { name: "intitulé" }], methods: [] },
      ],
      links: [
        { id: "l1", from: "e1", to: "a1", type: "mcd", cardFrom: "0,n" },
        { id: "l2", from: "e2", to: "a1", type: "mcd", cardFrom: "1,n" },
      ],
    };
  }
  return {
    kind,
    nodes: [
      { id: "c1", type: "class", name: "Personne", x: 60, y: 60, stereotype: "abstract", attributes: [{ name: "nom", type: "String", visibility: "-" }], methods: ["+ getNom() : String"] },
      { id: "c2", type: "class", name: "Étudiant", x: 60, y: 280, attributes: [{ name: "numéro", type: "int", visibility: "-" }], methods: [] },
      { id: "c3", type: "class", name: "Cours", x: 420, y: 280, attributes: [{ name: "code", type: "String", visibility: "-" }], methods: [] },
    ],
    links: [
      { id: "l1", from: "c2", to: "c1", type: "inheritance" },
      { id: "l2", from: "c2", to: "c3", type: "association", cardFrom: "*", cardTo: "1..*", label: "suit" },
    ],
  };
}

/** Lit un diagramme enregistré ; un contenu illisible donne un diagramme vide plutôt qu'une erreur. */
export function parseDiagram(content: string, fallback: DiagramKind = "mcd"): Diagram {
  try {
    const r = diagramSchema.safeParse(JSON.parse(content));
    if (r.success) return sanitizeDiagram(r.data);
  } catch {
    /* contenu illisible */
  }
  return emptyDiagram(fallback);
}

/**
 * Cohérence du diagramme : identifiants uniques, liens vers des éléments existants, notes jamais reliées,
 * règles de notation (une patte MCD relie toujours une entité à une association).
 */
export function sanitizeDiagram(d: Diagram): Diagram {
  const seen = new Set<string>();
  const nodes = d.nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const linkIds = new Set<string>();
  const links = d.links.filter((l) => {
    const a = byId.get(l.from);
    const b = byId.get(l.to);
    if (!a || !b || l.from === l.to || linkIds.has(l.id) || a.type === "note" || b.type === "note") return false;
    if (d.kind === "mcd") {
      if (l.type !== "mcd") return false;
      const pair = new Set([a.type, b.type]);
      if (!(pair.has("entity") && pair.has("association"))) return false;
    } else if (l.type === "mcd" || a.type !== "class" || b.type !== "class") return false;
    linkIds.add(l.id);
    return true;
  });
  // MCD : la cardinalité se lit côté entité ; on normalise pour que « from » soit toujours l'entité.
  const normalized = d.kind === "mcd" ? links.map((l) => (byId.get(l.from)?.type === "association" ? { ...l, from: l.to, to: l.from, cardFrom: l.cardTo ?? l.cardFrom, cardTo: undefined } : l)) : links;
  return { kind: d.kind, nodes, links: normalized };
}

/** Problèmes de notation repérables sans IA : affichés à l'étudiant comme vérifications, jamais comme correction. */
export function diagramWarnings(d: Diagram): string[] {
  const out: string[] = [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const degree = new Map<string, number>();
  for (const l of d.links) {
    degree.set(l.from, (degree.get(l.from) ?? 0) + 1);
    degree.set(l.to, (degree.get(l.to) ?? 0) + 1);
  }
  const names = new Map<string, number>();
  for (const n of d.nodes) if (n.type !== "note") names.set(n.name.toLowerCase(), (names.get(n.name.toLowerCase()) ?? 0) + 1);
  for (const [n, c] of names) if (c > 1) out.push(`Le nom « ${d.nodes.find((x) => x.name.toLowerCase() === n)?.name} » est utilisé ${c} fois.`);
  if (d.kind === "mcd") {
    for (const n of d.nodes) {
      if (n.type === "entity" && !n.attributes.some((a) => a.key)) out.push(`L'entité « ${n.name} » n'a pas d'identifiant.`);
      if (n.type === "association" && (degree.get(n.id) ?? 0) < 2) out.push(`L'association « ${n.name} » doit relier au moins deux pattes.`);
      if (n.type === "association" && n.attributes.some((a) => a.key)) out.push(`L'association « ${n.name} » ne porte pas d'identifiant propre : il vient des entités reliées.`);
    }
    for (const l of d.links) if (!l.cardFrom) out.push(`Une patte entre « ${byId.get(l.from)?.name} » et « ${byId.get(l.to)?.name} » n'a pas de cardinalité.`);
  } else {
    for (const l of d.links) if (l.type === "inheritance" && (l.cardFrom || l.cardTo)) out.push(`L'héritage entre « ${byId.get(l.from)?.name} » et « ${byId.get(l.to)?.name} » ne porte pas de multiplicités.`);
  }
  for (const n of d.nodes) if (n.type !== "note" && (degree.get(n.id) ?? 0) === 0 && d.nodes.length > 1) out.push(`« ${n.name} » n'est relié à rien.`);
  return out.slice(0, 20);
}

/** Description textuelle du diagramme, lisible par l'assistant IA (et par un humain). */
export function describeDiagram(d: Diagram): string {
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const lines: string[] = [`Type : ${DIAGRAM_KINDS[d.kind]}`];
  for (const n of d.nodes) {
    if (n.type === "note") {
      lines.push(`- Note [${n.id}] : ${n.text ?? n.name}`);
      continue;
    }
    const attrs = n.attributes.map((a) => `${a.visibility ?? ""}${a.key ? "#" : ""}${a.name}${a.type ? ` : ${a.type}` : ""}`).join(", ");
    const kind = n.type === "entity" ? "Entité" : n.type === "association" ? "Association" : "Classe";
    lines.push(`- ${kind} [${n.id}] ${n.name}${n.stereotype ? ` «${n.stereotype}»` : ""}${attrs ? ` (${attrs})` : ""}${n.methods.length ? ` opérations : ${n.methods.join(" ; ")}` : ""}`);
  }
  for (const l of d.links) {
    const a = byId.get(l.from)?.name ?? l.from;
    const b = byId.get(l.to)?.name ?? l.to;
    if (l.type === "mcd") lines.push(`- Patte [${l.id}] ${a} —(${l.cardFrom ?? "?"})— ${b}`);
    else lines.push(`- ${UML_LINK_TYPES[l.type as UmlLinkType]} [${l.id}] ${a}${l.cardFrom ? ` (${l.cardFrom})` : ""} → ${b}${l.cardTo ? ` (${l.cardTo})` : ""}${l.label ? ` « ${l.label} »` : ""}`);
  }
  if (d.nodes.length === 0) lines.push("(diagramme vide)");
  return lines.join("\n");
}

// ── Passage au modèle logique (MLD) : règles de transformation de Merise ─────────

export interface MldTable {
  name: string;
  columns: { name: string; pk: boolean; fk?: string }[];
  /** Règle appliquée, pour que l'étudiant comprenne d'où vient la table. */
  rule: string;
}

const maxOf = (card?: string) => (card?.trim().endsWith("1") ? "1" : "n");

/**
 * MCD → MLD (relationnel) :
 *  - chaque entité devient une table, son identifiant devient la clé primaire ;
 *  - une association binaire dont une patte est en (0,1) ou (1,1) disparaît : la clé de l'autre entité
 *    migre en clé étrangère du côté « 1 », avec les attributs de l'association ;
 *  - toute autre association (n,n ou n-aire) devient une table dont la clé primaire réunit les clés des entités reliées.
 */
export function mcdToMld(d: Diagram): MldTable[] {
  if (d.kind !== "mcd") return [];
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const keysOf = (id: string) => {
    const n = byId.get(id);
    const k = n?.attributes.filter((a) => a.key).map((a) => a.name) ?? [];
    return k.length ? k : [`id${(n?.name ?? "").replace(/\s+/g, "")}`];
  };
  const tables = new Map<string, MldTable>();
  for (const n of d.nodes) {
    if (n.type !== "entity") continue;
    const keys = keysOf(n.id);
    const cols = [...keys.map((k) => ({ name: k, pk: true })), ...n.attributes.filter((a) => !a.key).map((a) => ({ name: a.name, pk: false }))];
    tables.set(n.id, { name: n.name, columns: cols, rule: "Entité → table ; l'identifiant devient la clé primaire." });
  }
  for (const a of d.nodes) {
    if (a.type !== "association") continue;
    const legs = d.links.filter((l) => l.to === a.id && byId.get(l.from)?.type === "entity");
    if (legs.length < 2) continue;
    const ones = legs.filter((l) => maxOf(l.cardFrom) === "1");
    if (legs.length === 2 && ones.length >= 1) {
      const holder = ones[0];
      const other = legs.find((l) => l !== holder)!;
      const t = tables.get(holder.from);
      const target = byId.get(other.from);
      if (!t || !target) continue;
      for (const k of keysOf(other.from)) t.columns.push({ name: t.columns.some((c) => c.name === k) ? `${k}_${target.name}` : k, pk: false, fk: target.name });
      for (const at of a.attributes) t.columns.push({ name: at.name, pk: false });
      t.rule += ` La clé de ${target.name} y migre en clé étrangère (association « ${a.name} », cardinalité maximale 1 côté ${t.name}).`;
      continue;
    }
    const cols: MldTable["columns"] = [];
    for (const l of legs) {
      const e = byId.get(l.from);
      for (const k of keysOf(l.from)) cols.push({ name: cols.some((c) => c.name === k) ? `${k}_${e?.name}` : k, pk: true, fk: e?.name });
    }
    for (const at of a.attributes) cols.push({ name: at.name, pk: false });
    tables.set(a.id, { name: a.name, columns: cols, rule: legs.length > 2 ? "Association n-aire → table ; sa clé réunit les clés des entités reliées." : "Association (n,n) → table ; sa clé réunit les clés des deux entités." });
  }
  return [...tables.values()];
}

/**
 * Notation textuelle : TABLE (_cle_primaire_, attribut, #cle_etrangere). La clé primaire, soulignée à l'écran,
 * est encadrée de « _ » en texte brut ; une clé étrangère est précédée de « # ».
 */
export function mldText(tables: MldTable[]): string {
  return tables.map((t) => `${t.name} (${t.columns.map((c) => { const n = `${c.fk ? "#" : ""}${c.name}`; return c.pk ? `_${n}_` : n; }).join(", ")})`).join("\n");
}

// ── Proposition de l'assistant IA ──────────────────────────────────────────────

/** Balise du bloc de code dans lequel l'assistant renvoie le diagramme modifié. */
export const PROPOSAL_FENCE = "niala-diagram";

/** Extrait et valide la proposition de diagramme ; les éléments sans position reprennent l'ancienne ou une place libre. */
export function extractProposal(text: string, current: Diagram): { text: string; proposal: Diagram | null; invalid: boolean } {
  const re = new RegExp("```" + PROPOSAL_FENCE + "\\s*([\\s\\S]*?)(```|$)");
  const m = text.match(re);
  if (!m) return { text, proposal: null, invalid: false };
  const before = text.slice(0, m.index).trimEnd();
  try {
    const raw = JSON.parse(m[1]) as { kind?: string; nodes?: Record<string, unknown>[]; links?: unknown[] };
    const prev = new Map(current.nodes.map((n) => [n.id, n]));
    let slot = 0;
    const maxX = Math.max(0, ...current.nodes.map((n) => n.x));
    const nodes = (raw.nodes ?? []).map((n) => {
      const old = prev.get(String(n.id));
      const placed = typeof n.x === "number" && typeof n.y === "number";
      const pos = placed ? {} : old ? { x: old.x, y: old.y } : { x: maxX + 280 + (slot % 3) * 260, y: 60 + Math.floor(slot++ / 3) * 220 };
      return { attributes: [], methods: [], ...n, ...pos };
    });
    const parsed = diagramSchema.safeParse({ kind: current.kind, nodes, links: raw.links ?? [] });
    if (!parsed.success) return { text: before, proposal: null, invalid: true };
    return { text: before, proposal: sanitizeDiagram(parsed.data), invalid: false };
  } catch {
    return { text: before, proposal: null, invalid: true };
  }
}

