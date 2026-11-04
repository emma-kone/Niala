import { routes } from "@/config/routes";

export interface Recommendation {
  id: string;
  type: "EXERCISE" | "REVIEW" | "LAB";
  subjectId: string | null;
  subject: { name: string; color: string } | null;
  conceptId: string | null;
  concept: string | null;
  title: string;
  text: string;
  evidence: Record<string, unknown>;
  documentId: string | null;
  priority: number;
}

export interface DashboardData {
  resume: { type: string; title: string; subjectId: string | null; updatedAt: string; href: string | null } | null;
  next: Recommendation | null;
  recommendations: Recommendation[];
  attention: { kind: string; text: string; href?: string }[];
  subjects: {
    id: string;
    name: string;
    color: string;
    documents: number;
    exercises: number;
    notes: number;
    concepts: { total: number; measured: number; fragile: number; solid: number };
    mastery: number | null;
    confidence: number;
  }[];
  recent: { kind: string; title: string; at: string | null; detail: string | null; href: string | null }[];
  hasData: boolean;
}

export interface ProgressConcept {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  importance: number;
  level: number;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: string | null;
  band: "unknown" | "fragile" | "developing" | "solid" | "to_confirm";
  bandLabel: string;
  state: "NOT_ASSESSED" | "TO_DISCOVER" | "ACQUIRING" | "FRAGILE" | "MASTERED" | "CONFIRMED";
  stateLabel: string;
  needsRecheck: boolean;
  stateReasons: string[];
  prerequisites: { id: string; name: string }[];
}

export interface ProfileConceptDto {
  id: string;
  name: string;
  subjectName: string;
  stateLabel: string;
  needsRecheck: boolean;
  reasons: string[];
}

export interface LearningProfileDto {
  fragile: ProfileConceptDto[];
  recheck: ProfileConceptDto[];
  acquiring: ProfileConceptDto[];
  mastered: ProfileConceptDto[];
  overcome: ProfileConceptDto[];
  toDiscoverCount: number;
  recurring: { skill: string; label: string; note?: string; occurrences: number; languages: string[]; statement: string }[];
  recent: { id: string; at: string; activity: string; category: string | null; categoryLabel: string | null; summary: string; needsVerification: boolean; uncertain: boolean }[];
  hasData: boolean;
}

export interface ProgressData {
  concepts: ProgressConcept[];
  attempts: { id: string; title: string; subject: { id: string; name: string; color: string } | null; at: string | null; percentage: number | null }[];
  errors: { category: string; count: number }[];
  hypotheses: number;
}

export interface ConceptDetail {
  id: string;
  name: string;
  subject: { id: string; name: string };
  mastery: { level: number; confidence: number; band: string; bandLabel: string; evidenceCount: number; lastEvidenceAt: string | null } | null;
  sections: { label: string; page: number | null }[];
  evidence: { kind: "answer" | "lab"; label: string; score: number; weight: number; at: string; detail: Record<string, unknown> }[];
  howItIsComputed: string;
}

/** Destination d'une recommandation : toujours une vraie page (jamais un bouton sans action). */
export function recommendationHref(r: Recommendation): string | null {
  if (r.type === "LAB") return (r.evidence as { labKind?: string }).labKind === "SQL" ? routes.sql : routes.code;
  if (!r.subjectId) return null;
  if (r.type === "EXERCISE") {
    if (!r.documentId) return routes.subject(r.subjectId);
    const q = new URLSearchParams({ document: r.documentId });
    if (r.conceptId) q.set("concepts", r.conceptId);
    const adapt = (r.evidence as { adaptation?: string }).adaptation;
    if (adapt) q.set("adapt", adapt);
    return `${routes.subject(r.subjectId)}/exercices/nouveau?${q.toString()}`;
  }
  return r.documentId ? `${routes.subject(r.subjectId)}/documents/${r.documentId}` : routes.subject(r.subjectId);
}

export const ACTION_LABEL: Record<Recommendation["type"], string> = { EXERCISE: "Créer un exercice ciblé", REVIEW: "Relire le cours", LAB: "Ouvrir le laboratoire" };
export const pct = (n: number) => `${Math.round(n * 100)} %`;
