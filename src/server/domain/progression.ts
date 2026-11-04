import { estimateMastery, MIN_CONFIDENCE, type Evidence } from "./mastery";

// ─────────────────────────────────────────────────────────────────────────────
// États de progression d'une notion (6 états), recalculables à partir des observations.
// Aucun état ne dépend d'une seule réponse : « maîtrisée » exige plusieurs observations suffisamment sûres,
// « confirmée » exige en plus de la variété (activités ou difficultés différentes) et de la durée.
// Une notion anciennement maîtrisée sans observation récente reste maîtrisée mais est marquée « à revérifier ».
// ─────────────────────────────────────────────────────────────────────────────

export type ProgressState = "NOT_ASSESSED" | "TO_DISCOVER" | "ACQUIRING" | "FRAGILE" | "MASTERED" | "CONFIRMED";

export const STATE_LABEL: Record<ProgressState, string> = {
  NOT_ASSESSED: "Non évaluée",
  TO_DISCOVER: "À découvrir",
  ACQUIRING: "En cours d'acquisition",
  FRAGILE: "Fragile",
  MASTERED: "Maîtrisée",
  CONFIRMED: "Maîtrise confirmée",
};

export const STATE_HELP: Record<ProgressState, string> = {
  NOT_ASSESSED: "Aucune activité ne l'a encore évaluée.",
  TO_DISCOVER: "Trop peu d'observations pour juger : quelques exercices suffiraient.",
  ACQUIRING: "Des progrès, mais pas encore assez de réussites sûres.",
  FRAGILE: "Des difficultés se répètent : elle mérite une attention particulière.",
  MASTERED: "Plusieurs réussites sûres.",
  CONFIRMED: "Réussie dans des situations variées, sur plusieurs jours.",
};

export interface ProgressEvidence extends Evidence {
  /** Situation : type d'activité, difficulté… Plusieurs situations différentes = maîtrise mieux établie. */
  context?: string;
}

export interface ProgressOptions {
  now?: Date;
  /** Erreurs répétées (hors étourderie) observées récemment sur la notion. */
  repeatedErrors?: number;
  /** Indices consultés sur la notion. */
  hintsUsed?: number;
}

export interface ProgressResult {
  state: ProgressState;
  /** Notion anciennement maîtrisée sans observation récente : à vérifier de nouveau. */
  needsRecheck: boolean;
  level: number;
  confidence: number;
  attempts: number;
  successes: number;
  failures: number;
  contexts: number;
  reasons: string[];
}

export const RECHECK_AFTER_DAYS = 45;
const DAY = 24 * 3600 * 1000;
const SUCCESS = 0.7;
const FAILURE = 0.4;

export function progressionState(evidence: ProgressEvidence[], opts: ProgressOptions = {}): ProgressResult {
  const r = computeState(evidence, opts);
  const now = opts.now ?? new Date();
  if (evidence.length >= 2 && r.state !== "TO_DISCOVER" && r.state !== "NOT_ASSESSED") {
    const last = evidence.reduce((m, e) => (e.at > m ? e.at : m), evidence[0].at);
    const since = (now.getTime() - last.getTime()) / DAY;
    if (since > RECHECK_AFTER_DAYS) return { ...r, needsRecheck: true, reasons: [...r.reasons, `Dernière observation il y a ${Math.round(since)} jours : à vérifier de nouveau.`] };
  }
  return r;
}

function computeState(evidence: ProgressEvidence[], opts: ProgressOptions): ProgressResult {
  const now = opts.now ?? new Date();
  const est = estimateMastery(evidence, now);
  // L'état se juge sur ce qui a été observé, indépendamment du temps écoulé : une notion bien maîtrisée puis laissée de côté
  // ne retombe pas à « à découvrir » ; elle reste maîtrisée et est marquée « à revérifier ».
  const lastAt = evidence.reduce((m, e) => (e.at > m ? e.at : m), evidence[0]?.at ?? now);
  const judged = evidence.length ? estimateMastery(evidence.map((e) => ({ ...e, at: lastAt })), lastAt) : est;
  const successes = evidence.filter((e) => e.score >= SUCCESS);
  const failures = evidence.filter((e) => e.score < FAILURE);
  const contexts = new Set(evidence.map((e) => e.context ?? e.source.split(":")[0])).size;
  const sources = new Set(evidence.map((e) => e.source)).size;
  const base = { level: est.level, confidence: est.confidence, attempts: evidence.length, successes: successes.length, failures: failures.length, contexts, needsRecheck: false };
  const reasons: string[] = [];

  if (evidence.length === 0) return { ...base, state: "NOT_ASSESSED", reasons: ["Aucune observation."] };

  reasons.push(`${evidence.length} observation(s) : ${successes.length} réussie(s), ${failures.length} échec(s), sur ${contexts} situation(s) différente(s).`);
  const hints = opts.hintsUsed ?? 0;
  if (hints > 0) reasons.push(`${hints} indice(s) consulté(s).`);

  // Pas assez d'observations ou de confiance : on ne juge pas
  if (evidence.length < 2 || judged.confidence < MIN_CONFIDENCE) return { ...base, state: "TO_DISCOVER", reasons };

  const repeated = opts.repeatedErrors ?? 0;
  if (repeated >= 3 && judged.level < SUCCESS) reasons.push(`Erreurs répétées sur la notion (${repeated}).`);
  if (judged.level < 0.45 || (repeated >= 3 && judged.level < SUCCESS)) return { ...base, state: "FRAGILE", reasons };

  const solid = judged.level >= SUCCESS && judged.confidence >= 0.55 && successes.length >= 2;
  if (!solid) {
    if (judged.level >= SUCCESS) reasons.push("Bien parti, mais pas encore assez d'observations sûres.");
    return { ...base, state: "ACQUIRING", reasons };
  }

  const lastSuccess = successes.reduce((m, e) => (e.at > m ? e.at : m), successes[0].at);
  const firstSuccess = successes.reduce((m, e) => (e.at < m ? e.at : m), successes[0].at);
  const spanDays = (lastSuccess.getTime() - firstSuccess.getTime()) / DAY;
  const recheck = (now.getTime() - lastAt.getTime()) / DAY > RECHECK_AFTER_DAYS;

  const confirmed = successes.length >= 4 && sources >= 3 && contexts >= 2 && spanDays >= 2 && !recheck && hints <= successes.length;
  if (confirmed) reasons.push("Réussites variées, sur plusieurs jours.");
  else if (!recheck) reasons.push("Réussite sûre, mais pas encore assez variée ou étalée dans le temps pour être confirmée.");
  return { ...base, state: confirmed ? "CONFIRMED" : "MASTERED", reasons };
}
