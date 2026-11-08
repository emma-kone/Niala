import { independentGroups } from "./cross-check";
import type { SourceKind, SourceLevel } from "./sources";

// ─────────────────────────────────────────────────────────────────────────────
// Niveau de confiance d'une affirmation : table de règles, sans score chiffré.
// Le résultat dépend uniquement des preuves dont le serveur a contrôlé l'existence, jamais d'une
// auto-évaluation de l'IA. Ce n'est pas une probabilité d'exactitude.
// ─────────────────────────────────────────────────────────────────────────────

export type Confidence = "elevee" | "moderee" | "faible" | "non_verifiee" | "contradictoire";
export type ClaimType = "fait" | "hypothese" | "interpretation" | "opinion";
export type ClaimDomain = "sante" | "droit" | "actualite" | "programmation" | "sciences" | "general";
/** Sur quoi repose l'affirmation : le web, uniquement le document de l'étudiant, ou rien. */
export type ClaimBasis = "web" | "document" | "aucune";

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  elevee: "Confiance élevée",
  moderee: "Confiance modérée",
  faible: "Confiance faible",
  non_verifiee: "Information non vérifiée",
  contradictoire: "Informations contradictoires",
};

export interface EvaluatedSource {
  n: number;
  kind: "web" | "document";
  host?: string;
  text: string;
  level?: SourceLevel;
  sourceKind?: SourceKind;
  year?: number | null;
}

export interface EvaluatedEvidence {
  source: EvaluatedSource;
  stance: "soutient" | "contredit";
  direct: boolean;
}

export interface ClaimFacts {
  type: ClaimType;
  domain: ClaimDomain;
  /** L'information peut changer avec le temps (version, loi, chiffre, actualité). */
  timeSensitive: boolean;
}

export interface ClaimEvaluation {
  confidence: Confidence;
  basis: ClaimBasis;
  /** Pourquoi ce niveau, en une phrase. */
  reason: string;
  limits: string[];
  /** Avertissement à placer à côté de l'affirmation (null : rien à signaler dans le texte). */
  annotation: string | null;
  /** Le cours de l'étudiant est contredit par une source de référence. */
  courseConflict: boolean;
}

const SENSITIVE: ClaimDomain[] = ["sante", "droit", "actualite"];
/** Âge (en années) au-delà duquel une information évolutive peut être dépassée. */
const MAX_AGE: Record<ClaimDomain, number> = { sante: 2, droit: 2, actualite: 1, programmation: 3, sciences: 8, general: 5 };

export function isSensitive(domain: ClaimDomain) {
  return SENSITIVE.includes(domain);
}

const downgrade = (c: Confidence): Confidence => (c === "elevee" ? "moderee" : c === "moderee" ? "faible" : c);
const NON_FACT_NOTE: Record<Exclude<ClaimType, "fait">, string> = {
  hypothese: "Il s'agit d'une hypothèse, et non d'un fait établi.",
  interpretation: "Il s'agit d'une interprétation probable, et non d'un fait directement établi.",
  opinion: "Il s'agit d'une opinion, et non d'un fait établi.",
};

export function evaluateClaim(facts: ClaimFacts, evidence: EvaluatedEvidence[], now = new Date()): ClaimEvaluation {
  const web = evidence.filter((e) => e.source.kind === "web");
  const documents = evidence.filter((e) => e.source.kind === "document");
  const supports = web.filter((e) => e.stance === "soutient");
  const contradictions = web.filter((e) => e.stance === "contredit");
  const credible = (e: EvaluatedEvidence) => (e.source.level ?? 4) <= 2;
  const nonFact = facts.type === "fait" ? null : NON_FACT_NOTE[facts.type];
  const result = (confidence: Confidence, basis: ClaimBasis, reason: string, annotation: string | null, limits: string[] = [], courseConflict = false): ClaimEvaluation => ({ confidence, basis, reason, annotation, limits, courseConflict });

  if (!web.length) {
    if (documents.length) return result("non_verifiee", "document", "Provient du document de l'étudiant, sans vérification externe.", nonFact, ["Un cours importé n'est pas une preuve universelle."]);
    return result("non_verifiee", "aucune", "Aucune source consultée ne confirme ce point.", nonFact ?? "Aucune source consultée ne permet de confirmer ce point.");
  }

  const documentSays = documents.some((e) => e.stance === "soutient");
  const credibleAgainst = contradictions.some(credible);
  if (credibleAgainst && documentSays) {
    return result("contradictoire", "web", "Le document de l'étudiant et une source de référence ne disent pas la même chose.", "Votre cours affirme ceci, mais une source de référence indique autre chose : à vérifier auprès de votre enseignant.", [], true);
  }
  if (credibleAgainst && supports.some(credible)) {
    return result("contradictoire", "web", "Des sources crédibles aboutissent à des conclusions incompatibles.", "Les sources disponibles présentent des informations contradictoires sur ce point.");
  }
  if (credibleAgainst) return result("non_verifiee", "web", "Une source de référence contredit ce point.", "Cette affirmation est contredite par une source de référence.");
  if (!supports.length) return result("non_verifiee", "web", "Seules des sources peu fiables abordent ce point, et elles le contredisent.", "Aucune source consultée ne permet de confirmer ce point.");

  const limits: string[] = [];
  if (contradictions.length) limits.push("Une source peu fiable affirme le contraire.");
  const best = Math.min(...supports.map((e) => e.source.level ?? 4)) as SourceLevel;
  if (best === 4) return result("non_verifiee", "web", "Repose uniquement sur des sources peu fiables.", nonFact ?? "Cette information ne repose que sur des sources non vérifiées.", limits);
  if (best === 3) return result("faible", "web", "Repose sur des discussions communautaires.", nonFact ?? "Cette information est rapportée sur un forum spécialisé, mais elle n'a pas été confirmée par une documentation officielle.", limits);

  const strongest = supports.filter((e) => e.source.level === best);
  const groups = independentGroups(supports.filter(credible).map((e) => ({ n: e.source.n, host: e.source.host, text: e.source.text })));
  let confidence: Confidence = best === 1 ? "elevee" : "moderee";
  let reason = best === 1 ? "Confirmée par une source primaire ou institutionnelle." : "Soutenue par une source secondaire spécialisée.";
  let annotation: string | null = null;
  const note = (text: string) => {
    annotation ??= text;
    limits.push(text);
  };

  if (nonFact) {
    if (confidence === "elevee") confidence = "moderee";
    note(nonFact);
  }
  if (supports.every((e) => !e.direct)) {
    if (confidence === "elevee") confidence = "moderee";
    note("Il s'agit d'une déduction à partir des sources, et non d'un fait directement établi.");
  }
  const authoritative = strongest.some((e) => e.source.sourceKind === "loi" || e.source.sourceKind === "institution");
  if (isSensitive(facts.domain) && groups.length < 2 && !authoritative) {
    if (confidence === "elevee") confidence = "moderee";
    note("Ce point sensible n'est confirmé que par une seule source indépendante.");
  }
  if (facts.timeSensitive) {
    const years = strongest.map((e) => e.source.year).filter((y): y is number => y != null);
    const newest = years.length ? Math.max(...years) : null;
    if (newest != null && now.getFullYear() - newest > MAX_AGE[facts.domain]) {
      confidence = downgrade(confidence);
      note(`Cette information pourrait être obsolète (source de ${newest}).`);
    } else if (newest == null) {
      const living = strongest.some((e) => e.source.sourceKind === "documentation" || e.source.sourceKind === "loi");
      limits.push("Date de publication inconnue.");
      if (!living && confidence === "elevee") confidence = "moderee";
    }
  }
  if (groups.length > 1) reason += ` ${groups.length} sources indépendantes concordent.`;
  return result(confidence, "web", reason, annotation, limits);
}

export function summarize(claims: { confidence: Confidence; basis: ClaimBasis }[]) {
  const count = (c: Confidence) => claims.filter((x) => x.basis !== "document" && x.confidence === c).length;
  return { elevee: count("elevee"), moderee: count("moderee"), faible: count("faible"), non_verifiee: count("non_verifiee"), contradictoire: count("contradictoire"), document: claims.filter((x) => x.basis === "document").length };
}
