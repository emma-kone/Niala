import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { STATE_LABEL, type ProgressState } from "@/server/domain/progression";
import { recurringDifficulties, type CrossInsight } from "@/server/domain/skills";
import { CATEGORY_LABEL, type Category } from "@/server/diagnosis/engine";

// ─────────────────────────────────────────────────────────────────────────────
// Profil pédagogique : vue STRUCTURÉE et TRAÇABLE de ce que les observations permettent de dire de l'étudiant.
// Chaque élément renvoie à ses preuves (états recalculables, diagnostics, observations par compétence). Rien n'est
// stocké à part : le profil se recalcule toujours depuis les observations d'origine.
// Il alimente l'interface, le chat, les recommandations et la génération d'exercices.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfileConcept {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  state: ProgressState;
  stateLabel: string;
  needsRecheck: boolean;
  reasons: string[];
}

export interface RecentDiagnosis {
  id: string;
  at: Date;
  activity: string;
  category: string | null;
  categoryLabel: string | null;
  summary: string;
  needsVerification: boolean;
  uncertain: boolean;
}

export interface LearningProfile {
  fragile: ProfileConcept[];
  recheck: ProfileConcept[];
  acquiring: ProfileConcept[];
  mastered: ProfileConcept[];
  /** Anciennes difficultés (erreurs enregistrées) sur des notions désormais maîtrisées. */
  overcome: ProfileConcept[];
  toDiscoverCount: number;
  recurring: CrossInsight[];
  recent: RecentDiagnosis[];
  hasData: boolean;
}

export async function learningProfile(userId: string, subjectId?: string): Promise<LearningProfile> {
  if (subjectId) {
    const s = await db.subject.findFirst({ where: { id: subjectId, userId }, select: { id: true } });
    if (!s) throw new ApiHttpError("Matière introuvable.", 404);
  }
  const concepts = await db.concept.findMany({
    where: { userId, ...(subjectId ? { subjectId } : {}), mastery: { isNot: null } },
    include: { mastery: true, subject: { select: { name: true } } },
    take: 2000,
  });
  const view = (c: (typeof concepts)[number]): ProfileConcept => {
    const state = (c.mastery?.state as ProgressState | undefined) ?? "NOT_ASSESSED";
    return { id: c.id, name: c.name, subjectId: c.subjectId, subjectName: c.subject.name, state, stateLabel: STATE_LABEL[state], needsRecheck: c.mastery?.needsRecheck ?? false, reasons: (c.mastery?.stateReasons as string[] | null) ?? [] };
  };
  const all = concepts.map(view);

  const since = new Date(Date.now() - 45 * 24 * 3600 * 1000);
  const obs = await db.skillObservation.findMany({ where: { userId, createdAt: { gte: since }, ...(subjectId ? { OR: [{ report: { subjectId } }, { report: { subjectId: null } }] } : {}) }, select: { skill: true, language: true, activity: true, createdAt: true }, take: 2000 });
  const recurring = recurringDifficulties(obs.map((o) => ({ skill: o.skill, language: o.language, activity: o.activity, at: o.createdAt })));

  const reports = await db.diagnosisReport.findMany({ where: { userId, pedagogical: true, state: { not: "NONE" }, ...(subjectId ? { subjectId } : {}) }, orderBy: { createdAt: "desc" }, take: 6 });
  const masteredIds = all.filter((c) => c.state === "MASTERED" || c.state === "CONFIRMED").map((c) => c.id);
  const pastErrors = masteredIds.length ? await db.errorDiagnosis.groupBy({ by: ["conceptId"], where: { userId, conceptId: { in: masteredIds }, category: { not: "CARELESS" } }, _count: { _all: true } }) : [];
  const hadErrors = new Set(pastErrors.map((p) => p.conceptId));

  return {
    fragile: all.filter((c) => c.state === "FRAGILE"),
    recheck: all.filter((c) => c.needsRecheck),
    acquiring: all.filter((c) => c.state === "ACQUIRING"),
    mastered: all.filter((c) => c.state === "MASTERED" || c.state === "CONFIRMED"),
    overcome: all.filter((c) => (c.state === "MASTERED" || c.state === "CONFIRMED") && hadErrors.has(c.id)),
    toDiscoverCount: all.filter((c) => c.state === "TO_DISCOVER").length,
    recurring,
    recent: reports.map((r) => ({ id: r.id, at: r.createdAt, activity: r.activity, category: r.primary, categoryLabel: r.primary ? CATEGORY_LABEL[r.primary as Category] : null, summary: r.summary, needsVerification: r.needsVerification, uncertain: r.state === "UNCERTAIN" })),
    hasData: all.length > 0 || recurring.length > 0 || reports.length > 0,
  };
}

/**
 * Résumé court du profil pour le chat. Il ne contient que des observations mesurées, présentées comme telles, et ne dépasse
 * jamais ~900 caractères. Vide quand il n'y a rien de solide à dire.
 */
export function profileForPrompt(p: LearningProfile): string {
  const names = (list: ProfileConcept[], n = 4) => list.slice(0, n).map((c) => `« ${c.name} »`).join(", ");
  const lines: string[] = [];
  if (p.fragile.length) lines.push(`Notions mesurées comme fragiles : ${names(p.fragile)}.`);
  if (p.recheck.length) lines.push(`Notions anciennement acquises à revérifier : ${names(p.recheck)}.`);
  if (p.recurring.length) lines.push(`Difficultés qui se répètent (hypothèses à vérifier) : ${p.recurring.slice(0, 3).map((r) => r.label).join(" ; ")}.`);
  if (p.overcome.length) lines.push(`Difficultés dépassées : ${names(p.overcome, 3)}.`);
  if (!lines.length) return "";
  return lines.join("\n").slice(0, 900);
}
