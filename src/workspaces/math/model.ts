import { z } from "zod";

// Production d'un exercice de mathématiques : plusieurs parties (questions), chacune avec ses étapes de résolution et
// son résultat. Chaque expression garde son LaTeX (affichage) ET sa forme « ascii-math » (calcul : vérification des étapes,
// comparaison au résultat attendu, tracé).

const id = z.string().min(1).max(40);
const text = (n: number) => z.string().max(n).default("");

export const mathStepSchema = z.object({ id, latex: text(3000), ascii: text(1500), note: text(500) });
export type MathStep = z.infer<typeof mathStepSchema>;
export const mathPartSchema = z.object({
  id,
  label: text(60),
  steps: z.array(mathStepSchema).max(60).default([]),
  result: z.object({ latex: text(3000), ascii: text(1500) }).default({ latex: "", ascii: "" }),
});
export type MathPart = z.infer<typeof mathPartSchema>;
export const graphFunctionSchema = z.object({ id, ascii: text(500), latex: text(1000) });
export const graphSchema = z.object({
  functions: z.array(graphFunctionSchema).max(6).default([]),
  xmin: z.number().finite().default(-10),
  xmax: z.number().finite().default(10),
});

export const mathWorkSchema = z.object({
  parts: z.array(mathPartSchema).min(1).max(20).default([{ id: "p1", label: "Question 1", steps: [], result: { latex: "", ascii: "" } }]),
  graph: graphSchema.nullable().default(null),
});
export type MathWork = z.infer<typeof mathWorkSchema>;

export const emptyMath = (): MathWork => mathWorkSchema.parse({});
export function readMath(value: unknown): MathWork {
  const r = mathWorkSchema.safeParse(value ?? {});
  return r.success ? r.data : emptyMath();
}
export const newMathId = (p = "m") => `${p}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

/** Solution attendue : pour chaque partie, la ou les valeurs finales acceptées (expressions ascii-math). */
export const mathReferenceSchema = z.object({
  parts: z.array(z.object({ label: z.string().max(60).default(""), answers: z.array(z.string().min(1).max(300)).min(1).max(8), points: z.number().positive().max(100).optional() })).min(1).max(20),
  /** Le graphique est attendu pour cet exercice. */
  graph: z.boolean().default(false),
});
export type MathReference = z.infer<typeof mathReferenceSchema>;
