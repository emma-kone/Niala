import { z } from "zod";
import { parseCodeTests, sqlSpecSchema } from "./lab-tests";
import { randomBytes } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Modèle des exercices V2 : types de questions, configuration, barème EXACT, répartition
// des types et des difficultés. Tout ce qui est règle métier (barème, nombre de questions,
// bonnes réponses) est décidé ici, jamais par l'IA.
// ─────────────────────────────────────────────────────────────────────────────

import { DIFFICULTIES, POINT_STEP, QUESTION_TYPES, TYPE_LABEL, type QuestionType, CORRECTION_MODES, MAX_SOURCE_DOCUMENTS, PRACTICE_TYPES } from "./exercise-types";
export { DIFFICULTIES, POINT_STEP, QUESTION_TYPES, TYPE_LABEL };
export type { QuestionType };

/** Types corrigés sans IA (règles déterministes). */
export const OBJECTIVE_TYPES: QuestionType[] = ["qcm_single", "qcm_multiple", "true_false", "fill_choices", "fill_blank", "short_answer", "matching"];
/** Types dont la correction relève du jugement : IA (ou mots-clés pour la définition). */
export const OPEN_TYPES: QuestionType[] = ["definition", "open", "practical", "code", "sql"];

export type Difficulty = "facile" | "moyenne" | "difficile";

export const maxQuestions = () => Math.min(100, Math.max(1, Number(process.env.EXERCISE_MAX_QUESTIONS) || 40));

const id = z.string().min(1).max(64);

export const exerciseConfigSchema = z
  .object({
    /** Document principal : il rattache l'exercice à sa matière. */
    documentId: id,
    /** Tous les documents sources, document principal compris (facultatif quand il n'y en a qu'un). */
    documentIds: z.array(id).min(1).max(MAX_SOURCE_DOCUMENTS).optional(),
    title: z.string().trim().max(160).optional(),
    questionCount: z.number().int().min(1),
    /** Barème : note sur 10, 20, 100 ou personnalisée (maximum 100). */
    totalPoints: z.number().finite().min(POINT_STEP).max(100),
    types: z.array(z.enum(QUESTION_TYPES)).min(1).max(QUESTION_TYPES.length),
    coverage: z.object({
      mode: z.enum(["all", "sections", "concepts", "hard"]),
      sectionIds: z.array(id).max(100).optional(),
      conceptIds: z.array(id).max(100).optional(),
    }),
    difficulty: z.enum(DIFFICULTIES),
    correctionMode: z.enum(CORRECTION_MODES).default("final"),
    /** Part de questions pratiques en pourcentage ; absente, tous les types sont alternés. */
    practicePercent: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.questionCount > maxQuestions()) ctx.addIssue({ code: "custom", path: ["questionCount"], message: `Maximum ${maxQuestions()} questions.` });
    if (Math.abs(c.totalPoints / POINT_STEP - Math.round(c.totalPoints / POINT_STEP)) > 1e-9) ctx.addIssue({ code: "custom", path: ["totalPoints"], message: "Le barème doit être un multiple de 0,25." });
    if (c.totalPoints / POINT_STEP < c.questionCount) ctx.addIssue({ code: "custom", path: ["totalPoints"], message: "Barème trop petit pour ce nombre de questions (0,25 point minimum par question)." });
    if (c.coverage.mode !== "all" && new Set([c.documentId, ...(c.documentIds ?? [])]).size > 1) ctx.addIssue({ code: "custom", path: ["coverage"], message: "Avec plusieurs documents, l'exercice couvre obligatoirement tous leurs contenus." });
    if (c.coverage.mode === "sections" && !c.coverage.sectionIds?.length) ctx.addIssue({ code: "custom", path: ["coverage"], message: "Choisissez au moins une section." });
    if (c.coverage.mode === "concepts" && !c.coverage.conceptIds?.length) ctx.addIssue({ code: "custom", path: ["coverage"], message: "Choisissez au moins une notion." });
  });
export type ExerciseConfig = z.infer<typeof exerciseConfigSchema>;

// ── Barème exact ─────────────────────────────────────────────────────────────

/** Répartit `total` points entre des questions pondérées ; la somme est EXACTEMENT `total` (pas de 0,25). */
export function allocatePoints(total: number, weights: number[]): number[] {
  const units = Math.round(total / POINT_STEP);
  const n = weights.length;
  if (n === 0) return [];
  if (units < n) throw new Error("Barème trop petit pour ce nombre de questions.");
  const base = new Array<number>(n).fill(1); // au moins un pas par question
  let remaining = units - n;
  const sum = weights.reduce((a, b) => a + b, 0) || n;
  const shares = weights.map((w) => (w / sum) * remaining);
  const floors = shares.map(Math.floor);
  floors.forEach((f, i) => (base[i] += f));
  remaining -= floors.reduce((a, b) => a + b, 0);
  const order = shares.map((s, i) => ({ i, frac: s - Math.floor(s) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remaining; k++) base[order[k % n].i]++;
  return base.map((u) => u * POINT_STEP);
}

export const DIFFICULTY_WEIGHT: Record<Difficulty, number> = { facile: 1, moyenne: 1.5, difficile: 2 };

// ── Créneaux : répartition des types et des difficultés ──────────────────────

export interface Slot {
  slot: number; // 1..n
  type: QuestionType;
  difficulty: Difficulty;
}

/** Type de chaque créneau. Avec une part de pratique, les questions pratiques sont réparties régulièrement dans l'exercice. */
function typeSequence(count: number, types: QuestionType[], practicePercent?: number): QuestionType[] {
  const uniq = [...new Set(types)];
  const practice = uniq.filter((t) => PRACTICE_TYPES.includes(t));
  const theory = uniq.filter((t) => !PRACTICE_TYPES.includes(t));
  if (practicePercent === undefined || !practice.length || !theory.length) return Array.from({ length: count }, (_, i) => uniq[i % uniq.length]);
  const practiceCount = Math.round((count * practicePercent) / 100);
  let p = 0;
  let t = 0;
  return Array.from({ length: count }, (_, i) => {
    const isPractice = Math.floor(((i + 1) * practiceCount) / count) > Math.floor((i * practiceCount) / count);
    return isPractice ? practice[p++ % practice.length] : theory[t++ % theory.length];
  });
}

export function buildSlots(count: number, types: QuestionType[], difficulty: ExerciseConfig["difficulty"], practicePercent?: number): Slot[] {
  const sequence = typeSequence(count, types, practicePercent);
  const cycle: Difficulty[] = ["facile", "moyenne", "difficile", "moyenne"];
  return Array.from({ length: count }, (_, i) => {
    let d: Difficulty;
    if (difficulty === "progressive") d = (["facile", "moyenne", "difficile"] as const)[Math.min(2, Math.floor((i * 3) / count))];
    else if (difficulty === "melangee") d = cycle[i % cycle.length];
    else d = difficulty;
    return { slot: i + 1, type: sequence[i], difficulty: d };
  });
}

// ── Questions générées par l'IA : validation stricte par type ────────────────

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const common = {
  slot: z.number().int().min(1),
  statement: text(900, 8),
  source: z.object({ quote: text(500, 12) }),
  concepts: z.array(text(120, 2)).max(4).catch([]),
  explanation: text(1000, 2).optional(),
};
const blanksCount = (s: string) => (s.match(/___/g) ?? []).length;

export const rawQuestionSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("qcm_single"), options: z.array(text(300)).min(3).max(5), correctIndex: z.number().int().min(0) }),
  z.object({ ...common, type: z.literal("qcm_multiple"), options: z.array(text(300)).min(4).max(6), correctIndexes: z.array(z.number().int().min(0)).min(1) }),
  z.object({ ...common, type: z.literal("true_false"), answer: z.boolean() }),
  z.object({ ...common, type: z.literal("fill_choices"), blanks: z.array(z.object({ options: z.array(text(120)).min(3).max(5), correctIndex: z.number().int().min(0) })).min(1).max(4) }),
  z.object({ ...common, type: z.literal("fill_blank"), blanks: z.array(z.object({ accepted: z.array(text(120)).min(1).max(4) })).min(1).max(4) }),
  z.object({ ...common, type: z.literal("short_answer"), accepted: z.array(text(160)).min(1).max(5) }),
  z.object({ ...common, type: z.literal("definition"), reference: text(900, 5), keyPoints: z.array(text(160)).min(2).max(6) }),
  z.object({ ...common, type: z.literal("open"), reference: text(1500, 5), criteria: z.array(text(200)).min(2).max(5) }),
  z.object({ ...common, type: z.literal("matching"), pairs: z.array(z.object({ left: text(160), right: text(200) })).min(3).max(6) }),
  z.object({ ...common, type: z.literal("practical"), reference: text(1500, 5), criteria: z.array(text(200)).min(2).max(5) }),
  z.object({ ...common, type: z.literal("code"), language: text(20), starterCode: z.string().max(2000).optional(), referenceSolution: text(3000, 3), criteria: z.array(text(200)).min(2).max(5), tests: z.array(z.unknown()).max(10).optional() }),
  z.object({
    ...common,
    type: z.literal("sql"),
    setupSql: z.string().max(4000).optional(),
    referenceSql: text(2000, 6),
    criteria: z.array(text(200)).min(2).max(5),
    ordered: z.boolean().optional(),
    checks: z.array(text(1000)).max(3).optional(),
    variants: z.array(z.object({ name: text(80), extraSql: text(2000) })).max(4).optional(),
  }),
]);
export type RawQuestion = z.infer<typeof rawQuestionSchema>;

/** Cohérences que le schéma seul ne vérifie pas (indices, nombre de trous). */
export function semanticProblem(q: RawQuestion): string | null {
  switch (q.type) {
    case "qcm_single":
      if (q.correctIndex >= q.options.length) return "indice de bonne réponse hors limites";
      if (new Set(q.options.map((o) => o.toLowerCase())).size !== q.options.length) return "propositions en double";
      return null;
    case "qcm_multiple":
      if (q.correctIndexes.some((i) => i >= q.options.length) || new Set(q.correctIndexes).size !== q.correctIndexes.length) return "indices invalides";
      if (q.correctIndexes.length >= q.options.length) return "toutes les propositions sont correctes";
      return null;
    case "fill_choices":
      if (blanksCount(q.statement) !== q.blanks.length) return "nombre de trous incohérent";
      if (q.blanks.some((b) => b.correctIndex >= b.options.length)) return "indice de bonne réponse hors limites";
      return null;
    case "fill_blank":
      return blanksCount(q.statement) === q.blanks.length ? null : "nombre de trous incohérent";
    case "matching":
      return new Set(q.pairs.map((p) => p.left.toLowerCase())).size === q.pairs.length && new Set(q.pairs.map((p) => p.right.toLowerCase())).size === q.pairs.length ? null : "éléments en double";
    default:
      return null;
  }
}

// ── Charge utile (visible de l'étudiant) / clé de correction (serveur) ───────

const rid = () => randomBytes(4).toString("hex");
function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface BuiltQuestion {
  type: QuestionType;
  payload: Record<string, unknown>;
  answerKey: Record<string, unknown>;
}

export function buildQuestion(q: RawQuestion): BuiltQuestion {
  switch (q.type) {
    case "qcm_single":
    case "qcm_multiple": {
      const opts = q.options.map((label, i) => ({ id: rid(), label, correct: q.type === "qcm_single" ? i === q.correctIndex : q.correctIndexes.includes(i) }));
      const mixed = shuffled(opts);
      return { type: q.type, payload: { statement: q.statement, options: mixed.map(({ id: oid, label }) => ({ id: oid, label })) }, answerKey: { correct: mixed.filter((o) => o.correct).map((o) => o.id) } };
    }
    case "true_false":
      return { type: q.type, payload: { statement: q.statement }, answerKey: { answer: q.answer } };
    case "fill_choices": {
      const blanks = q.blanks.map((b) => ({ id: rid(), options: shuffled(b.options), answer: b.options[b.correctIndex] }));
      return { type: q.type, payload: { statement: q.statement, blanks: blanks.map(({ id: bid, options }) => ({ id: bid, options })) }, answerKey: { answers: Object.fromEntries(blanks.map((b) => [b.id, b.answer])) } };
    }
    case "fill_blank": {
      const blanks = q.blanks.map((b) => ({ id: rid(), accepted: b.accepted }));
      return { type: q.type, payload: { statement: q.statement, blanks: blanks.map((b) => ({ id: b.id })) }, answerKey: { answers: Object.fromEntries(blanks.map((b) => [b.id, b.accepted])) } };
    }
    case "short_answer":
      return { type: q.type, payload: { statement: q.statement }, answerKey: { accepted: q.accepted } };
    case "definition":
      return { type: q.type, payload: { statement: q.statement }, answerKey: { reference: q.reference, keyPoints: q.keyPoints } };
    case "open":
    case "practical":
      return { type: q.type, payload: { statement: q.statement }, answerKey: { reference: q.reference, criteria: q.criteria } };
    case "matching": {
      const pairs = q.pairs.map((p) => ({ lid: rid(), rid: rid(), left: p.left, right: p.right }));
      return {
        type: q.type,
        payload: { statement: q.statement, left: pairs.map((p) => ({ id: p.lid, label: p.left })), right: shuffled(pairs.map((p) => ({ id: p.rid, label: p.right }))) },
        answerKey: { pairs: Object.fromEntries(pairs.map((p) => [p.lid, p.rid])) },
      };
    }
    case "code":
      // Les tests proposés par l'IA ne sont que des CANDIDATS : ils ne sont retenus qu'après exécution de la solution de référence (voir labs/validate).
      return { type: q.type, payload: { statement: q.statement, language: q.language, starterCode: q.starterCode ?? "" }, answerKey: { reference: q.referenceSolution, criteria: q.criteria, tests: parseCodeTests(q.tests ?? []), verified: false } };
    case "sql":
      return {
        type: q.type,
        payload: { statement: q.statement, setupSql: q.setupSql ?? "" },
        answerKey: { reference: q.referenceSql, criteria: q.criteria, sql: sqlSpecSchema.parse({ setupSql: q.setupSql ?? "", referenceSql: q.referenceSql, checks: q.checks ?? [], ordered: q.ordered ?? false, variants: q.variants ?? [] }), verified: false },
      };
  }
}
