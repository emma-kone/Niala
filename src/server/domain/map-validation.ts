import { z } from "zod";

// Validation stricte de l'état d'une carte envoyé par l'éditeur : le client n'est jamais fiable.

export const MAX_NODES = 500;
export const MAX_EDGES = 1500;

const id = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/, "Identifiant invalide.");
const coord = z.number().finite().min(-200_000).max(200_000);

export const originSchema = z.enum(["DOCUMENT", "AI_INFERRED", "USER"]);
export const relationTypeSchema = z.enum(["PREREQUISITE", "PART_OF", "EXAMPLE_OF", "DEFINES", "CONTRASTS", "RELATED"]);

export const mapNodeSchema = z.object({
  id,
  label: z.string().trim().min(1, "Le contenu d'un nœud ne peut pas être vide.").max(200),
  x: coord,
  y: coord,
  origin: originSchema,
  conceptId: z.string().min(1).nullable().optional(),
  sectionId: z.string().min(1).nullable().optional(),
  data: z
    .object({ note: z.string().max(2000).optional(), edited: z.boolean().optional(), page: z.number().int().min(1).nullable().optional(), definition: z.string().max(600).optional() })
    .strict()
    .nullable()
    .optional(),
});

export const mapEdgeSchema = z.object({
  id,
  source: id,
  target: id,
  type: relationTypeSchema,
  label: z.string().trim().max(80).nullable().optional(),
  origin: originSchema,
});

export const mapStateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    nodes: z.array(mapNodeSchema).max(MAX_NODES),
    edges: z.array(mapEdgeSchema).max(MAX_EDGES),
  })
  .superRefine((m, ctx) => {
    const ids = new Set<string>();
    for (const n of m.nodes) {
      if (ids.has(n.id)) ctx.addIssue({ code: "custom", message: `Nœud en double : ${n.id}` });
      ids.add(n.id);
    }
    const edgeIds = new Set<string>();
    const pairs = new Set<string>();
    for (const e of m.edges) {
      if (edgeIds.has(e.id)) ctx.addIssue({ code: "custom", message: `Relation en double : ${e.id}` });
      edgeIds.add(e.id);
      if (!ids.has(e.source) || !ids.has(e.target)) ctx.addIssue({ code: "custom", message: "Une relation pointe vers un nœud inexistant." });
      if (e.source === e.target) ctx.addIssue({ code: "custom", message: "Un nœud ne peut pas être relié à lui-même." });
      const key = `${e.source}|${e.target}|${e.type}`;
      if (pairs.has(key)) ctx.addIssue({ code: "custom", message: "Relation en double entre deux nœuds." });
      pairs.add(key);
    }
  });

export type MapState = z.infer<typeof mapStateSchema>;
export type MapNodeInput = z.infer<typeof mapNodeSchema>;
export type MapEdgeInput = z.infer<typeof mapEdgeSchema>;
