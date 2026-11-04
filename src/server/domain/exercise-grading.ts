import { foldText } from "@/server/ai/guard";
import type { QuestionType } from "./exercise-model";

// ─────────────────────────────────────────────────────────────────────────────
// Correction OBJECTIVE (déterministe, sans IA) : QCM, vrai/faux, textes à trous, réponse courte,
// association, et repli par mots-clés pour les définitions.
// ─────────────────────────────────────────────────────────────────────────────

export type Verdict = "correct" | "partial" | "incorrect" | "skipped" | "ungraded";

export interface Grade {
  verdict: Verdict;
  /** null : non corrigé (aucun point attribué, ne compte pas dans le score). */
  points: number | null;
  /** Réponse attendue, présentable à l'étudiant après correction. */
  expected: unknown;
  /** Détail par élément (trous, paires, propositions) pour expliquer les erreurs. */
  detail?: Record<string, unknown>;
  method: "rule" | "keywords";
}

const round = (n: number) => Math.round(n * 100) / 100;

function fromRatio(ratio: number, max: number): Pick<Grade, "verdict" | "points"> {
  const r = Math.max(0, Math.min(1, ratio));
  return { verdict: r >= 0.999 ? "correct" : r > 0 ? "partial" : "incorrect", points: round(max * r) };
}

const isBlank = (v: unknown): boolean =>
  v == null ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => x == null || String(x).trim() === ""));

/** Normalisation des réponses textuelles : casse, accents, ponctuation, virgule décimale. */
export function normalizeAnswer(s: string): string {
  return foldText(s.replace(/(\d),(\d)/g, "$1.$2")).replace(/\b(le|la|les|l|un|une|des|du|de|d)\b/g, " ").replace(/\s+/g, " ").trim();
}
const sameText = (a: string, accepted: string[]) => accepted.some((x) => normalizeAnswer(x) === normalizeAnswer(a) && normalizeAnswer(a) !== "");

type Key = Record<string, unknown>;

export function gradeObjective(type: QuestionType, key: Key, value: unknown, max: number): Grade | null {
  if (isBlank(value)) {
    return { verdict: "skipped", points: 0, expected: expectedOf(type, key), method: "rule" };
  }
  switch (type) {
    case "qcm_single": {
      const ok = (key.correct as string[]).includes(String(value));
      return { ...fromRatio(ok ? 1 : 0, max), expected: key.correct, method: "rule" };
    }
    case "qcm_multiple": {
      const correct = key.correct as string[];
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      const hits = chosen.filter((c) => correct.includes(c)).length;
      const wrong = chosen.filter((c) => !correct.includes(c)).length;
      return { ...fromRatio((hits - wrong) / correct.length, max), expected: correct, detail: { hits, wrong, total: correct.length }, method: "rule" };
    }
    case "true_false": {
      const ok = typeof value === "boolean" && value === key.answer;
      return { ...fromRatio(ok ? 1 : 0, max), expected: key.answer, method: "rule" };
    }
    case "fill_choices":
    case "fill_blank": {
      const answers = key.answers as Record<string, string | string[]>;
      const given = (value ?? {}) as Record<string, string>;
      const per: Record<string, boolean> = {};
      for (const [bid, expected] of Object.entries(answers)) {
        const g = String(given[bid] ?? "");
        per[bid] = type === "fill_choices" ? g === expected : sameText(g, expected as string[]);
      }
      const ok = Object.values(per).filter(Boolean).length;
      return { ...fromRatio(ok / Object.keys(answers).length, max), expected: answers, detail: { blanks: per }, method: "rule" };
    }
    case "short_answer": {
      const ok = sameText(String(value), key.accepted as string[]);
      return { ...fromRatio(ok ? 1 : 0, max), expected: key.accepted, method: "rule" };
    }
    case "matching": {
      const pairs = key.pairs as Record<string, string>;
      const given = (value ?? {}) as Record<string, string>;
      const per: Record<string, boolean> = {};
      for (const [l, r] of Object.entries(pairs)) per[l] = given[l] === r;
      const ok = Object.values(per).filter(Boolean).length;
      return { ...fromRatio(ok / Object.keys(pairs).length, max), expected: pairs, detail: { pairs: per }, method: "rule" };
    }
    default:
      return null;
  }
}

function expectedOf(type: QuestionType, key: Key): unknown {
  if (type === "short_answer") return key.accepted;
  if ("correct" in key) return key.correct;
  if ("answer" in key) return key.answer;
  if ("answers" in key) return key.answers;
  if ("pairs" in key) return key.pairs;
  return key.reference ?? null;
}

/**
 * Repli sans IA pour une définition : part des points clés retrouvés dans la réponse.
 * Mesure LIMITÉE (mots-clés) : le résultat est signalé comme tel à l'étudiant.
 */
export function gradeKeywords(key: Key, value: unknown, max: number): Grade {
  const expected = { reference: key.reference, keyPoints: key.keyPoints };
  if (isBlank(value)) return { verdict: "skipped", points: 0, expected, method: "keywords" };
  const answer = normalizeAnswer(String(value));
  const points = (key.keyPoints as string[]) ?? [];
  const found = points.map((p) => {
    const words = normalizeAnswer(p).split(" ").filter((w) => w.length > 3);
    if (words.length === 0) return answer.includes(normalizeAnswer(p));
    return words.filter((w) => answer.includes(w)).length / words.length >= 0.6;
  });
  const hits = found.filter(Boolean).length;
  return { ...fromRatio(points.length ? hits / points.length : 0, max), expected, detail: { keyPoints: points.map((p, i) => ({ point: p, found: found[i] })) }, method: "keywords" };
}

export function skippedGrade(type: QuestionType, key: Key): Grade {
  return { verdict: "skipped", points: 0, expected: expectedOf(type, key), method: "rule" };
}

export function ungradedGrade(type: QuestionType, key: Key): Grade {
  return { verdict: "ungraded", points: null, expected: expectedOf(type, key), method: "rule" };
}
