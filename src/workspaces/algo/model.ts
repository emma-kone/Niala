import { z } from "zod";

export const ALGO_LANGUAGES = ["pseudo", "python", "javascript", "typescript", "c", "java", "other"] as const;
export type AlgoLanguage = (typeof ALGO_LANGUAGES)[number];
export const ALGO_LANGUAGE_LABEL: Record<AlgoLanguage, string> = { pseudo: "Pseudo-code", python: "Python", javascript: "JavaScript", typescript: "TypeScript", c: "C", java: "Java", other: "Autre" };
/** Langages que le runner isolé de Niala sait exécuter. */
export const EXECUTABLE: readonly AlgoLanguage[] = ["python", "javascript", "typescript"];

export const algoWorkSchema = z.object({
  language: z.enum(ALGO_LANGUAGES).default("pseudo"),
  code: z.string().max(40_000).default(""),
  /** Entrée standard fournie à l'exécution. */
  stdin: z.string().max(4000).default(""),
  /** Dernière exécution : conservée pour reprendre là où l'étudiant s'était arrêté. */
  lastRun: z.object({ ok: z.boolean(), output: z.string().max(8000) }).nullable().default(null),
});
export type AlgoWork = z.infer<typeof algoWorkSchema>;
export const emptyAlgo = (language: AlgoLanguage = "pseudo"): AlgoWork => algoWorkSchema.parse({ language });
export function readAlgo(value: unknown, fallback: AlgoLanguage = "pseudo"): AlgoWork {
  const r = algoWorkSchema.safeParse(value ?? {});
  return r.success ? r.data : emptyAlgo(fallback);
}

/** Forme attendue (donnée par le cours) : mots-clés du formalisme, pour ne pas imposer un langage réel. */
export const algoSpecSchema = z.object({
  language: z.enum(ALGO_LANGUAGES).default("pseudo"),
  /** Formalisme du cours, en texte libre (ex. « Algorithme / Variables / Début / Fin, affectation avec ← »). */
  formalism: z.string().max(600).optional(),
});
export type AlgoSpec = z.infer<typeof algoSpecSchema>;
