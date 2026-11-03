// ─────────────────────────────────────────────────────────────────────────────
// Estimation de maîtrise par notion, RECALCULABLE à partir des preuves (réponses, tests de laboratoire).
//  - Une note d'exercice n'est pas une mesure de maîtrise : on estime chaque NOTION à partir des questions
//    qui l'évaluent, pondérées par leur difficulté, avec une décroissance dans le temps.
//  - Toute estimation s'accompagne d'une CONFIANCE : peu de preuves → « pas assez de données », jamais une
//    maîtrise affirmée sur une seule réponse.
//  - Les notions ne sont jamais fusionnées entre matières (l'identité d'une notion est son identifiant).
// ─────────────────────────────────────────────────────────────────────────────

export interface Evidence {
  /** Réussite de la question pour cette notion, 0..1. */
  score: number;
  /** Poids de la preuve (difficulté, type de correction). */
  weight: number;
  at: Date;
  /** Origine distincte (tentative, espace de travail) : plusieurs origines → confiance plus solide. */
  source: string;
}

export const HALF_LIFE_DAYS = 30;
/** Poids du prior neutre (0,5) : une seule preuve ne peut pas faire passer la maîtrise à 0 ou 1. */
const PRIOR_WEIGHT = 1;
const DAY = 24 * 3600 * 1000;

export const DIFFICULTY_EVIDENCE_WEIGHT: Record<string, number> = { facile: 0.7, moyenne: 1, difficile: 1.3 };

export interface MasteryEstimate {
  level: number;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function estimateMastery(evidence: Evidence[], now: Date = new Date()): MasteryEstimate {
  if (evidence.length === 0) return { level: 0, confidence: 0, evidenceCount: 0, lastEvidenceAt: null };
  let wSum = 0;
  let wScore = 0;
  let last = evidence[0].at;
  for (const e of evidence) {
    const age = Math.max(0, (now.getTime() - e.at.getTime()) / DAY);
    const w = e.weight * Math.pow(0.5, age / HALF_LIFE_DAYS);
    wSum += w;
    wScore += w * Math.min(1, Math.max(0, e.score));
    if (e.at > last) last = e.at;
  }
  const level = (wScore + PRIOR_WEIGHT * 0.5) / (wSum + PRIOR_WEIGHT);
  const sources = new Set(evidence.map((e) => e.source)).size;
  const base = 1 - Math.exp(-wSum / 4);
  // des preuves issues d'une seule tentative valent moins que des preuves répétées dans le temps
  const confidence = base * Math.min(1, 0.5 + 0.25 * sources);
  return { level: round(level), confidence: round(confidence), evidenceCount: evidence.length, lastEvidenceAt: last };
}

export type Band = "unknown" | "fragile" | "developing" | "solid" | "to_confirm";

export const MIN_CONFIDENCE = 0.35;

export function masteryBand(level: number, confidence: number): Band {
  if (confidence < MIN_CONFIDENCE) return "unknown";
  if (level < 0.45) return "fragile";
  if (level >= 0.7) return confidence >= 0.55 ? "solid" : "to_confirm";
  return "developing";
}

export const BAND_LABEL: Record<Band, string> = {
  unknown: "Pas assez de données",
  fragile: "Fragile",
  developing: "En progression",
  solid: "Solide",
  to_confirm: "Bien parti, à confirmer",
};

/** Score d'une réponse pour les notions de la question (null : non évaluable, aucune preuve). */
export function answerEvidenceScore(verdict: string | null, points: number | null, max: number): number | null {
  if (!verdict || verdict === "ungraded") return null;
  if (verdict === "skipped") return 0;
  if (points == null || max <= 0) return null;
  return Math.min(1, Math.max(0, points / max));
}
