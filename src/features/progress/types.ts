import { routes } from "@/config/routes";
import type { CourseToday, ScheduleStatus } from "@/server/domain/dashboard";

export interface Recommendation {
  id: string;
  type: "EXERCISE" | "REVIEW" | "LAB";
  subjectId: string | null;
  subject: { name: string; color: string; icon?: string | null } | null;
  conceptId: string | null;
  concept: string | null;
  title: string;
  text: string;
  evidence: Record<string, unknown>;
  documentId: string | null;
  priority: number;
}

export interface DashboardTask {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  dueDate: string;
  dueMinutes: number | null;
  subjectName: string | null;
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
  recentDocuments: { id: string; name: string; type: string; lastOpenedAt: string; lastPage: number | null; pageCount: number | null; subjectId: string; subjectName: string; subjectColor: string; subjectIcon: string | null; href: string }[];
  /** Séances de la date réelle jusqu'à l'horizon de recherche du prochain cours. */
  today: CourseToday[];
  schedule: ScheduleStatus;
  breaks: { label: string; startMinutes: number; endMinutes: number; weekday: number | null }[];
  academic: { late: DashboardTask[]; upcoming: DashboardTask[]; priority: DashboardTask[]; sessions: { id: string; date: string; title: string; startMinutes: number; endMinutes: number; done: boolean }[] };
  highlight: { kind: string; eyebrow: string; title: string; detail: string; href: string | null; cta: string | null };
  suggestions: { id: string; kind: string; title: string; text: string; href: string | null; recommendationId?: string }[];
  overallMastery: number | null;
  /** Série de jours consécutifs d'activité ; null si le calcul a échoué (le reste du tableau de bord reste affiché). */
  streak: { current: number; longest: number; doneToday: boolean; atRisk: boolean; lastDay: string | null; totalDays: number; week: { date: string; active: boolean }[]; message: string } | null;
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
  prerequisites: { id: string; name: string }[];
}

export interface ProgressData {
  concepts: ProgressConcept[];
  attempts: { id: string; title: string; subject: { id: string; name: string; color: string; icon?: string | null } | null; at: string | null; percentage: number | null }[];
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
    return `${routes.subject(r.subjectId)}/exercices/nouveau?${q.toString()}`;
  }
  return r.documentId ? `${routes.subject(r.subjectId)}/documents/${r.documentId}` : routes.subject(r.subjectId);
}

export const ACTION_LABEL: Record<Recommendation["type"], string> = { EXERCISE: "Créer un exercice ciblé", REVIEW: "Relire le cours", LAB: "Ouvrir le laboratoire" };
export const pct = (n: number) => `${Math.round(n * 100)} %`;

/** Quantité de preuves derrière une estimation : un repère qualitatif, jamais une probabilité d'exactitude. */
export const evidenceLabel = (confidence: number) => (confidence >= 0.7 ? "preuves suffisantes" : confidence >= 0.35 ? "preuves partielles" : "preuves limitées");
