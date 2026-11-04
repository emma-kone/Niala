import type { Diagnosis } from "@/server/domain/lab-tests";

// ─────────────────────────────────────────────────────────────────────────────
// Moteur de diagnostic pédagogique : fonction PURE (sans base ni réseau).
// Il reçoit les constats des évaluateurs techniques (tests exécutés, compilateur, moteur SQL, règles) et
// produit UN diagnostic structuré, identique pour toutes les activités.
//  - Ce que les outils établissent est un FAIT (confiance élevée) ; ce qui relève de la compréhension
//    (concept, démarche, inattention) n'est jamais affirmé : c'est une HYPOTHÈSE, marquée « à vérifier ».
//  - Sans preuve suffisante : état INCERTAIN et demande de clarification, jamais de cause inventée.
//  - Une erreur d'environnement n'est pas une lacune de l'étudiant (pedagogical = false).
// L'interprétation par l'IA (phase suivante) ne pourra qu'AJOUTER des hypothèses à ce socle, et sera rejetée
// si elle contredit ces constats (voir `validateInterpretation`).
// ─────────────────────────────────────────────────────────────────────────────

export const ENGINE_VERSION = "1";

export type Category = "SYNTAX" | "LOGIC" | "CONCEPT" | "METHOD" | "INSTRUCTION" | "FORGETTING" | "CARELESS" | "ALGORITHM" | "ENVIRONMENT";
export type Activity = "EXERCISE" | "CODE" | "SQL";
export type Severity = "none" | "low" | "medium" | "high";
export type DiagnosisStateName = "NONE" | "DETERMINED" | "UNCERTAIN";
export type RecommendedAction = "none" | "retry" | "targeted_explanation" | "review_prerequisite" | "clarifying_question" | "check_environment" | "verify_understanding";

export interface EngineInput {
  activity: Activity;
  language?: string;
  /** Résultat global observé par les outils. */
  status: "pass" | "fail" | "error" | "timeout" | "unavailable";
  /** Constats déterministes (classification des tests, règles de correction). */
  diagnoses: Diagnosis[];
  error?: { type: string; message: string; line?: number };
  expected?: unknown;
  observed?: unknown;
  tests?: { passed: number; total: number; edgePassed: number; edgeTotal: number };
  concepts: { id?: string; name: string }[];
  /** Prérequis des notions concernées dont la maîtrise est mesurée (relation PREREQUISITE). */
  prerequisites?: { name: string; level: number; confidence: number }[];
  history?: {
    /** Tentatives antérieures avec une erreur de la même catégorie (même notion ou même espace). */
    sameCategory: number;
    /** Réussites antérieures sur la même notion. */
    priorSuccesses: number;
    hintsUsed: number;
  };
}

export interface ReportConcept {
  id?: string;
  name: string;
  confidence: number;
}

export interface Report {
  state: DiagnosisStateName;
  primary: Category | null;
  secondary: Category[];
  summary: string;
  evidence: string[];
  expected?: unknown;
  observed?: unknown;
  concepts: ReportConcept[];
  prerequisites: { name: string; reason: string }[];
  severity: Severity;
  confidence: number;
  pedagogical: boolean;
  recommendedAction: RecommendedAction;
  needsVerification: boolean;
  source: "tools";
  engineVersion: string;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  SYNTAX: "Erreur de syntaxe",
  LOGIC: "Erreur de logique",
  CONCEPT: "Notion mal comprise",
  METHOD: "Démarche à améliorer",
  INSTRUCTION: "Consigne non respectée",
  FORGETTING: "Oubli",
  CARELESS: "Inattention possible",
  ALGORITHM: "Erreur algorithmique",
  ENVIRONMENT: "Problème d'environnement",
};

export const UNDETERMINED_MESSAGE = "Impossible de déterminer précisément l'origine de cette erreur avec les informations disponibles.";

const ENVIRONMENT_RE = /ModuleNotFoundError|No module named|ImportError|Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND|out of memory|MemoryError/i;

const PRIORITY: Category[] = ["ENVIRONMENT", "SYNTAX", "INSTRUCTION", "ALGORITHM", "CONCEPT", "LOGIC", "METHOD", "FORGETTING", "CARELESS"];
const rank = (c: Category) => PRIORITY.indexOf(c);
const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function buildReport(input: EngineInput): Report {
  const concepts: ReportConcept[] = input.concepts.map((c) => ({ id: c.id, name: c.name, confidence: 0.5 }));
  const base = { expected: input.expected, observed: input.observed, concepts, prerequisites: [] as Report["prerequisites"], source: "tools" as const, engineVersion: ENGINE_VERSION };

  // ── Réussite ──────────────────────────────────────────────────────────────
  if (input.status === "pass") {
    const hints = input.history?.hintsUsed ?? 0;
    const lucky = hints >= 2;
    return {
      ...base,
      state: "NONE",
      primary: null,
      secondary: [],
      summary: lucky ? `Réussite, mais avec ${hints} indices : la maîtrise de la notion n'est pas encore confirmée.` : "Aucune erreur observée.",
      evidence: input.tests ? [`${input.tests.passed} test(s) réussi(s) sur ${input.tests.total}.`] : ["Réponse jugée correcte par les outils de correction."],
      severity: "none",
      confidence: 0.9,
      pedagogical: true,
      recommendedAction: lucky ? "verify_understanding" : "none",
      needsVerification: lucky,
    };
  }

  // ── Environnement : jamais une lacune de l'étudiant ──────────────────────
  const envError = input.error && ENVIRONMENT_RE.test(`${input.error.type} ${input.error.message}`);
  if (input.status === "unavailable" || envError) {
    return {
      ...base,
      state: "DETERMINED",
      primary: "ENVIRONMENT",
      secondary: [],
      summary: input.status === "unavailable" ? "L'exécution n'a pas pu avoir lieu (service d'exécution indisponible) : ce n'est pas une erreur de l'étudiant." : "Le programme utilise une bibliothèque ou une ressource qui n'est pas disponible dans l'environnement d'exécution de Niala : ce n'est pas forcément une erreur de l'étudiant.",
      evidence: [input.error ? `${input.error.type} : ${input.error.message}` : "Exécution indisponible."],
      severity: "low",
      confidence: 0.9,
      pedagogical: false,
      recommendedAction: "check_environment",
      needsVerification: false,
    };
  }

  // ── Constats déterministes ───────────────────────────────────────────────
  const found = [...input.diagnoses].sort((a, b) => rank(a.category as Category) - rank(b.category as Category) || b.confidence - a.confidence);
  const evidence: string[] = [];
  for (const d of found) evidence.push(d.label);
  if (input.error) evidence.push(`Message de l'outil : ${input.error.type} : ${input.error.message}${input.error.line ? ` (ligne ${input.error.line})` : ""}`);
  if (input.tests && input.tests.total) evidence.push(`${input.tests.passed} test(s) réussi(s) sur ${input.tests.total}${input.tests.edgeTotal ? ` (cas limites : ${input.tests.edgePassed}/${input.tests.edgeTotal})` : ""}.`);

  if (!found.length) {
    return {
      ...base,
      state: "UNCERTAIN",
      primary: null,
      secondary: [],
      summary: UNDETERMINED_MESSAGE,
      evidence: evidence.length ? evidence : ["Aucun constat technique n'explique l'échec."],
      severity: "medium",
      confidence: 0.2,
      pedagogical: true,
      recommendedAction: "clarifying_question",
      needsVerification: true,
    };
  }

  const primary = found[0].category as Category;
  const secondary = [...new Set(found.slice(1).map((d) => d.category as Category))].filter((c) => c !== primary);
  let confidence = Math.max(...found.map((d) => d.confidence));
  const hist = input.history ?? { sameCategory: 0, priorSuccesses: 0, hintsUsed: 0 };
  let needsVerification = false;
  let action: RecommendedAction = primary === "SYNTAX" ? "targeted_explanation" : primary === "INSTRUCTION" ? "retry" : "retry";

  // Répétition : même type d'erreur sur plusieurs tentatives → piste conceptuelle, à vérifier (jamais affirmée)
  if (hist.sameCategory >= 2) {
    evidence.push(`Même type d'erreur sur ${hist.sameCategory} tentative(s) précédente(s).`);
    confidence = clamp(confidence + 0.05);
    action = "targeted_explanation";
    if (primary === "LOGIC" || primary === "ALGORITHM") {
      needsVerification = true;
      action = "clarifying_question";
      evidence.push("Une difficulté de compréhension est possible : à vérifier avec une question ciblée.");
    }
  }

  // Erreur isolée après des réussites : inattention POSSIBLE (hypothèse faible)
  if (hist.sameCategory === 0 && hist.priorSuccesses >= 2 && (primary === "LOGIC" || primary === "SYNTAX") && !secondary.includes("CARELESS")) {
    secondary.push("CARELESS");
    evidence.push(`Réussites antérieures sur la même notion et erreur isolée : une simple inattention est possible (hypothèse).`);
    needsVerification = true;
  }

  // Prérequis : seulement ceux dont la FAIBLESSE est mesurée, jamais propagés par défaut
  const weak = (input.prerequisites ?? []).filter((p) => p.confidence >= 0.35 && p.level < 0.5);
  const prerequisites = weak.map((p) => ({ name: p.name, reason: `Maîtrise mesurée à ${Math.round(p.level * 100)} % : la difficulté pourrait venir de cette base.` }));
  if (prerequisites.length && (primary === "LOGIC" || primary === "CONCEPT" || primary === "ALGORITHM") && hist.sameCategory >= 1) {
    action = "review_prerequisite";
    needsVerification = true;
  }

  // Concept, démarche et algorithme ne se prouvent pas par des tests : toujours présentés comme hypothèse à vérifier
  if (primary === "CONCEPT" || primary === "METHOD" || primary === "ALGORITHM") {
    needsVerification = true;
    if (action !== "review_prerequisite") action = "clarifying_question";
  }

  const logicRatio = input.tests && input.tests.total ? input.tests.passed / input.tests.total : null;
  const severity: Severity = primary === "CONCEPT" || primary === "ALGORITHM" || hist.sameCategory >= 2 ? "high" : primary === "LOGIC" && logicRatio !== null && logicRatio < 0.5 ? "high" : primary === "SYNTAX" || primary === "INSTRUCTION" || primary === "LOGIC" ? "medium" : "low";

  return {
    ...base,
    prerequisites,
    state: "DETERMINED",
    primary,
    secondary,
    summary: found[0].label,
    evidence,
    severity,
    confidence: round(confidence),
    pedagogical: true,
    recommendedAction: action,
    needsVerification,
  };
}

// ── Garde-fou pour l'interprétation par l'IA (phase suivante) ────────────────

export interface Interpretation {
  primary: Category | null;
  confidence: number;
  summary: string;
  evidence: string[];
}

/**
 * Une interprétation de l'IA est refusée si elle contredit les faits techniques, si elle affirme une confiance que
 * les preuves ne justifient pas, ou si elle invoque des preuves absentes du dossier.
 */
export function validateInterpretation(base: Report, ai: Interpretation, input: EngineInput): { ok: true } | { ok: false; reason: string } {
  if (ai.confidence < 0 || ai.confidence > 1 || !Number.isFinite(ai.confidence)) return { ok: false, reason: "confiance hors bornes" };
  if (input.status === "pass" && ai.primary) return { ok: false, reason: "erreur affirmée alors que les outils concluent à une réussite" };
  if (base.primary === "ENVIRONMENT" && ai.primary && ai.primary !== "ENVIRONMENT") return { ok: false, reason: "erreur d'environnement attribuée à l'étudiant" };
  if (ai.primary === "SYNTAX" && !base.secondary.concat(base.primary ? [base.primary] : []).includes("SYNTAX")) return { ok: false, reason: "erreur de syntaxe affirmée sans constat de l'outil" };
  if (base.primary === "SYNTAX" && ai.primary && ai.primary !== "SYNTAX") return { ok: false, reason: "contredit l'erreur de syntaxe établie par l'outil" };
  const soft: Category[] = ["CONCEPT", "METHOD", "ALGORITHM", "CARELESS", "FORGETTING"];
  const supported = (input.history?.sameCategory ?? 0) + (input.tests?.total ? 1 : 0);
  if (ai.primary && soft.includes(ai.primary) && ai.confidence > 0.75 && supported < 2) return { ok: false, reason: "confiance élevée injustifiée pour une hypothèse de compréhension" };
  const known = new Set(base.evidence.map((e) => e.toLowerCase()));
  if (ai.evidence.some((e) => !known.has(e.trim().toLowerCase()))) return { ok: false, reason: "preuve absente du dossier technique" };
  return { ok: true };
}
