import { MIN_CONFIDENCE } from "./mastery";

// ─────────────────────────────────────────────────────────────────────────────
// Recommandations d'activité : règles explicites et justifiées, jamais opaques.
// Chaque recommandation porte sa raison lisible ET les preuves chiffrées qui la fondent.
// ─────────────────────────────────────────────────────────────────────────────

export interface ConceptView {
  id: string;
  name: string;
  subjectId: string;
  importance: number;
  level: number;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  /** Notions prérequises (relation PREREQUISITE entrante), avec leur état. */
  prerequisites: { id: string; name: string; level: number; confidence: number; evidenceCount: number }[];
}

export interface ErrorTally {
  kind: string;
  category: string;
  count: number;
  label: string;
  subjectId: string | null;
  labKind: "CODE" | "SQL" | null;
}

export type RecType = "EXERCISE" | "REVIEW" | "LAB";

export interface Rec {
  type: RecType;
  subjectId: string;
  conceptId: string | null;
  priority: number;
  title: string;
  /** Raison lisible par l'étudiant. */
  text: string;
  /** Preuves chiffrées. */
  evidence: Record<string, unknown>;
  /** Clé de dédoublonnage (pour ne pas réafficher une recommandation écartée). */
  key: string;
}

const DAY = 24 * 3600 * 1000;
const pct = (n: number) => `${Math.round(n * 100)} %`;
const isWeak = (c: { level: number; confidence: number }) => c.confidence >= MIN_CONFIDENCE && c.level < 0.5;

export function buildRecommendations(concepts: ConceptView[], errors: ErrorTally[], now: Date = new Date(), max = 8): Rec[] {
  const out: Rec[] = [];
  const byId = new Map(concepts.map((c) => [c.id, c]));

  for (const c of concepts) {
    const age = c.lastEvidenceAt ? (now.getTime() - c.lastEvidenceAt.getTime()) / DAY : null;

    if (isWeak(c)) {
      // Un prérequis fragile passe avant : inutile d'insister sur une notion dont la base est fragile.
      const weakPre = c.prerequisites.find((p) => isWeak(p));
      if (weakPre) {
        out.push({
          type: "EXERCISE",
          subjectId: c.subjectId,
          conceptId: weakPre.id,
          priority: 110 + (0.5 - weakPre.level) * 100 + c.importance * 5,
          title: `Consolider « ${weakPre.name} »`,
          text: `« ${weakPre.name} » est un prérequis de « ${c.name} », et votre maîtrise estimée de ce prérequis est fragile (${pct(weakPre.level)}, d'après ${weakPre.evidenceCount} réponse(s)). Mieux vaut le consolider avant de continuer.`,
          evidence: { concept: weakPre.name, level: weakPre.level, confidence: weakPre.confidence, evidenceCount: weakPre.evidenceCount, blocks: c.name, adaptation: "prerequisite" },
          key: `EXERCISE:${weakPre.id}`,
        });
        continue;
      }
      out.push({
        type: "EXERCISE",
        subjectId: c.subjectId,
        conceptId: c.id,
        priority: 100 + (0.5 - c.level) * 100 + c.importance * 5,
        title: `S'entraîner sur « ${c.name} »`,
        text: `Votre maîtrise estimée de « ${c.name} » est fragile (${pct(c.level)}, d'après ${c.evidenceCount} réponse(s)${age != null ? `, dernière il y a ${Math.round(age)} jour(s)` : ""}).`,
        evidence: { concept: c.name, level: c.level, confidence: c.confidence, evidenceCount: c.evidenceCount, daysSince: age != null ? Math.round(age) : null },
        key: `EXERCISE:${c.id}`,
      });
    } else if (c.evidenceCount === 0 && c.importance >= 3) {
      out.push({
        type: "EXERCISE",
        subjectId: c.subjectId,
        conceptId: c.id,
        priority: 55 + c.importance * 3,
        title: `Mesurer votre maîtrise de « ${c.name} »`,
        text: `« ${c.name} » est une notion principale du cours, mais aucun exercice ne l'a encore évaluée : on ne sait pas où vous en êtes.`,
        evidence: { concept: c.name, evidenceCount: 0, importance: c.importance },
        key: `EXERCISE:${c.id}`,
      });
    } else if (c.confidence >= MIN_CONFIDENCE && c.level >= 0.7 && age != null && age > 30) {
      out.push({
        type: "REVIEW",
        subjectId: c.subjectId,
        conceptId: c.id,
        priority: 30 + Math.min(age, 90) / 3,
        title: `Réviser « ${c.name} »`,
        text: `Vous maîtrisiez « ${c.name} » (${pct(c.level)}), mais la dernière preuve date de ${Math.round(age)} jours : une révision espacée évite l'oubli.`,
        evidence: { concept: c.name, level: c.level, confidence: c.confidence, daysSince: Math.round(age) },
        key: `REVIEW:${c.id}`,
      });
    }
  }

  // Erreurs récurrentes dans les laboratoires : un schéma d'erreur répété mérite un entraînement ciblé.
  for (const e of errors) {
    if (!e.labKind || !e.subjectId || e.count < 3) continue;
    out.push({
      type: "LAB",
      subjectId: e.subjectId,
      conceptId: null,
      priority: 70 + Math.min(e.count, 10),
      title: e.labKind === "SQL" ? "S'entraîner en SQL sur vos erreurs récurrentes" : "S'entraîner en programmation sur vos erreurs récurrentes",
      text: `${e.count} fois ces 14 derniers jours : ${e.label}`,
      evidence: { kind: e.kind, category: e.category, count: e.count, labKind: e.labKind },
      key: `LAB:${e.labKind}:${e.kind}:${e.subjectId}`,
    });
  }

  const seen = new Set<string>();
  return out
    .sort((a, b) => b.priority - a.priority)
    .filter((r) => (seen.has(r.key) ? false : (seen.add(r.key), true)))
    .slice(0, max)
    .map((r) => ({ ...r, priority: Math.round(r.priority) }));
}

// ── Adaptation fondée sur le diagnostic ──────────────────────────────────────

export interface AdaptationInput {
  concepts: (ConceptView & { state: string })[];
  /** Difficultés récurrentes (compétences) observées, avec leur sujet quand il est connu. */
  recurring: { skill: string; label: string; occurrences: number; subjectId: string | null }[];
  /** Notions sur lesquelles au moins deux diagnostics de CONFUSION (hypothèse) ont été posés. */
  confusions: { conceptId: string; count: number }[];
}

/**
 * Recommandations d'exercices ADAPTÉS, chacune justifiée par ses observations :
 *  - raisonnement et cas limites quand la logique pose problème de façon répétée (la syntaxe n'est pas en cause) ;
 *  - comparaison de notions quand des confusions se répètent ;
 *  - difficulté supérieure quand une notion est maîtrisée sur plusieurs observations sûres.
 * Le renvoi vers un prérequis fragile est déjà géré par `buildRecommendations`.
 */
export function buildAdaptations(input: AdaptationInput, max = 4): Rec[] {
  const out: Rec[] = [];
  const reasoning = new Set(["cas-limites", "logique-resultat", "conditions-arret"]);
  for (const r of input.recurring) {
    if (!reasoning.has(r.skill) || !r.subjectId || r.occurrences < 3) continue;
    out.push({
      type: "LAB",
      subjectId: r.subjectId,
      conceptId: null,
      priority: 75 + Math.min(r.occurrences, 8),
      title: "S'entraîner au raisonnement et aux cas limites",
      text: `La difficulté « ${r.label} » s'est répétée ${r.occurrences} fois, alors que la syntaxe n'est pas en cause : des exercices de raisonnement (vide, zéro, bornes) sont plus utiles que de réécrire du code.`,
      evidence: { adaptation: "edge_cases", skill: r.skill, count: r.occurrences },
      key: `ADAPT:edge:${r.skill}:${r.subjectId}`,
    });
  }
  const byId = new Map(input.concepts.map((c) => [c.id, c]));
  for (const f of input.confusions) {
    const c = byId.get(f.conceptId);
    if (!c || f.count < 2) continue;
    out.push({
      type: "EXERCISE",
      subjectId: c.subjectId,
      conceptId: c.id,
      priority: 85 + Math.min(f.count, 5),
      title: `Distinguer des notions voisines autour de « ${c.name} »`,
      text: `Des réponses fausses se répètent (${f.count}) sur « ${c.name} » d'une façon qui évoque une confusion possible : un exercice de comparaison permet de le vérifier.`,
      evidence: { adaptation: "compare", concept: c.name, count: f.count },
      key: `ADAPT:compare:${c.id}`,
    });
  }
  for (const c of input.concepts) {
    if ((c.state !== "MASTERED" && c.state !== "CONFIRMED") || c.evidenceCount < 3 || c.importance < 2) continue;
    out.push({
      type: "EXERCISE",
      subjectId: c.subjectId,
      conceptId: c.id,
      priority: 40 + c.importance * 2,
      title: `Passer à la difficulté supérieure sur « ${c.name} »`,
      text: `Vous maîtrisez « ${c.name} » sur ${c.evidenceCount} observations : des situations plus difficiles ou combinant plusieurs notions confirmeraient et approfondiraient cet acquis.`,
      evidence: { adaptation: "harder", concept: c.name, level: c.level, evidenceCount: c.evidenceCount },
      key: `ADAPT:harder:${c.id}`,
    });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, max);
}
