import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Base de modélisation Merise : UN seul document partagé par tous les outils (dictionnaire, dépendances, MCD, MLD, MPD,
// MCT, flux). Un MLD se génère depuis le MCD, un MPD depuis le MLD et le dictionnaire : les modèles ne sont pas des
// dessins indépendants.
// ─────────────────────────────────────────────────────────────────────────────

export const CARDINALITIES = ["0,1", "1,1", "0,N", "1,N"] as const;
export type Cardinality = (typeof CARDINALITIES)[number];
export const DATA_TYPES = ["AN", "N", "D", "B", "T"] as const; // alphanumérique, numérique, date, booléen, texte long
export const DATA_TYPE_LABEL: Record<string, string> = { AN: "Alphanumérique", N: "Numérique", D: "Date", B: "Booléen", T: "Texte long" };

const id = z.string().min(1).max(40);
const text = (n: number) => z.string().max(n).default("");
const coord = z.number().finite().min(-100_000).max(100_000).default(0);

export const dictionaryItemSchema = z.object({
  id,
  code: text(40),
  label: text(120),
  type: text(10),
  size: text(10),
  format: text(30),
  description: text(300),
  nature: z.enum(["elementaire", "calculee"]).default("elementaire"),
  rule: text(300),
  notes: text(300),
});
export type DictionaryItem = z.infer<typeof dictionaryItemSchema>;

export const dependencySchema = z.object({ id, from: z.array(z.string().max(40)).max(10).default([]), to: z.array(z.string().max(40)).max(10).default([]) });
export type Dependency = z.infer<typeof dependencySchema>;

const attributeSchema = z.object({ id, name: text(60), isId: z.boolean().default(false) });
export const entitySchema = z.object({ id, name: text(60), x: coord, y: coord, attributes: z.array(attributeSchema).max(40).default([]) });
export const linkSchema = z.object({ id, entityId: id, card: z.enum(CARDINALITIES).default("0,N") });
export const associationSchema = z.object({ id, name: text(60), x: coord, y: coord, attributes: z.array(attributeSchema.omit({ isId: true })).max(20).default([]), links: z.array(linkSchema).max(6).default([]) });
export type Entity = z.infer<typeof entitySchema>;
export type Association = z.infer<typeof associationSchema>;
export type Mcd = { entities: Entity[]; associations: Association[] };

const mldColumnSchema = z.object({ id, name: text(60), pk: z.boolean().default(false), fkTable: text(60), fkColumn: text(60) });
export const mldTableSchema = z.object({ id, name: text(60), columns: z.array(mldColumnSchema).max(60).default([]) });
export type MldTable = z.infer<typeof mldTableSchema>;

const mpdColumnSchema = mldColumnSchema.extend({ type: text(30), size: text(10), notNull: z.boolean().default(false), unique: z.boolean().default(false) });
export const mpdTableSchema = z.object({ id, name: text(60), columns: z.array(mpdColumnSchema).max(60).default([]) });
export type MpdTable = z.infer<typeof mpdTableSchema>;

export const MCT_KINDS = ["event", "operation", "result", "sync"] as const;
export const mctNodeSchema = z.object({ id, kind: z.enum(MCT_KINDS).default("operation"), label: text(120), rule: text(200), x: coord, y: coord });
export const mctEdgeSchema = z.object({ id, from: id, to: id });
export const flowActorSchema = z.object({ id, name: text(60), kind: z.enum(["interne", "externe"]).default("externe"), x: coord, y: coord });
export const flowSchema = z.object({ id, from: id, to: id, label: text(120) });

export const meriseWorkSchema = z.object({
  dictionary: z.array(dictionaryItemSchema).max(300).default([]),
  dependencies: z.array(dependencySchema).max(300).default([]),
  mcd: z.object({ entities: z.array(entitySchema).max(40).default([]), associations: z.array(associationSchema).max(60).default([]) }).default({ entities: [], associations: [] }),
  /** Tables du MLD ; `edited` passe à vrai dès que l'étudiant modifie à la main le résultat de la génération. */
  mld: z.object({ tables: z.array(mldTableSchema).max(80).default([]), edited: z.boolean().default(false) }).default({ tables: [], edited: false }),
  mpd: z.object({ tables: z.array(mpdTableSchema).max(80).default([]), edited: z.boolean().default(false) }).default({ tables: [], edited: false }),
  mct: z.object({ nodes: z.array(mctNodeSchema).max(80).default([]), edges: z.array(mctEdgeSchema).max(200).default([]) }).default({ nodes: [], edges: [] }),
  flows: z.object({ actors: z.array(flowActorSchema).max(40).default([]), flows: z.array(flowSchema).max(120).default([]) }).default({ actors: [], flows: [] }),
});
export type MeriseWork = z.infer<typeof meriseWorkSchema>;

export const emptyMerise = (): MeriseWork => meriseWorkSchema.parse({});

/** Lecture tolérante d'une production enregistrée : une valeur absente ou abîmée donne un atelier vide, jamais une erreur. */
export function readMerise(value: unknown): MeriseWork {
  const r = meriseWorkSchema.safeParse(value ?? {});
  return r.success ? r.data : emptyMerise();
}

export const newId = (prefix = "x") => `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

// ── Référence de correction (facultative) : la solution attendue, sous forme structurée ──
export const meriseReferenceSchema = z.object({
  deliverables: z.array(z.enum(["dictionary", "dependencies", "mcd", "mld", "mpd", "mct", "flows"])).max(7).default(["mcd"]),
  entities: z.array(z.object({ name: z.string().min(1).max(60), attributes: z.array(z.string().max(60)).max(30).default([]), identifier: z.array(z.string().max(60)).max(6).default([]) })).max(30).default([]),
  associations: z.array(z.object({ name: z.string().max(60).optional(), links: z.array(z.object({ entity: z.string().min(1).max(60), card: z.enum(CARDINALITIES) })).min(2).max(6) })).max(40).default([]),
});
export type MeriseReference = z.infer<typeof meriseReferenceSchema>;
