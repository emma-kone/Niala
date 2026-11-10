import type { Assistance, CorrectionMode, ExerciseMode, QuestionType } from "@/server/domain/exercise-types";
import { routes } from "@/config/routes";

/** Racine des pages d'un exercice : sous sa matière, ou directement sous /exercices s'il n'en a pas. */
export const exercisesBase = (subjectId: string | null | undefined) => (subjectId ? `${routes.subject(subjectId)}/exercices` : routes.exercises);

export interface ExerciseListItem {
  id: string;
  title: string;
  subject: { id: string; name: string; color: string; icon?: string | null } | null;
  document: { id: string; name: string } | null;
  origin: string;
  freeSubject: string | null;
  versionNumber: number | null;
  createdAt: string;
  totalPoints: number;
  questions: number;
  attempts: number;
  inProgress: string | null;
  best: number | null;
  last: number | null;
  notice: string | null;
}

export interface ExerciseDetail {
  id: string;
  title: string;
  subject: { id: string; name: string; color: string; icon?: string | null } | null;
  document: { id: string; name: string } | null;
  origin: string;
  saved: boolean;
  versionNumber: number | null;
  createdAt: string;
  totalPoints: number;
  notice: string | null;
  requested: number | null;
  config: { types: string[]; difficulty: string | null; coverage: string | null; correctionMode: CorrectionMode; practicePercent: number | null; sources: { id: string; name: string }[]; mode: ExerciseMode | null; free: { subject: string; chapter: string; level: string } | null };
  questions: { position: number; type: QuestionType; points: number; difficulty: string }[];
  attempts: { id: string; status: "IN_PROGRESS" | "SUBMITTED" | "GRADED"; score: number | null; maxScore: number | null; startedAt: string; finishedAt: string | null; durationSec: number | null; answered: number }[];
}

export type Verdict = "correct" | "partial" | "incorrect" | "skipped" | "ungraded";

export interface QuestionResult {
  verdict: Verdict;
  points: number | null;
  max: number;
  expected: unknown;
  detail?: Record<string, unknown>;
  explanation: string | null;
  questionExplanation: string | null;
  method: "rule" | "keywords" | "ai" | "tests";
}

export interface AttemptQuestion {
  position: number;
  type: QuestionType;
  points: number;
  difficulty: string;
  payload: Record<string, unknown>;
  answer: unknown;
  result?: QuestionResult | null;
  sourceRefs?: { quote: string; page: number | null; documentId?: string; documentName?: string; subjectId?: string | null }[];
  concepts?: { id: string; name: string }[];
}

export interface AttemptReview {
  overview: string;
  strengths: string[];
  priorities: { topic: string; advice: string }[];
  questions: { position: number; comment: string }[];
}

export interface AttemptDetail {
  id: string;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  correctionMode: CorrectionMode;
  assistance: Assistance;
  saved: boolean;
  review: AttemptReview | null;
  exercise: { id: string; title: string; totalPoints: number; documentId: string | null; documentName: string | null; versionNumber: number | null; subjectId: string | null };
  lastPosition: number;
  score: number | null;
  maxScore: number | null;
  ungraded: number;
  gradedMax: number | null;
  startedAt: string;
  finishedAt: string | null;
  questions: AttemptQuestion[];
}

export interface ExerciseOptions {
  document: { id: string; name: string; subjectId: string | null; ready: boolean; pageCount: number | null; kind: "sheet" | "course" };
  aiConfigured: boolean;
  maxQuestions: number;
  analysis: { id: string } | null;
  sections: { id: string; label: string; numbering: string | null; level: number; parentId: string | null; position: number }[];
  concepts: { id: string; name: string; importance: number }[];
}

export const VERDICT_LABEL: Record<Verdict, { label: string; className: string }> = {
  correct: { label: "Correct", className: "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" },
  partial: { label: "Partiel", className: "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300" },
  incorrect: { label: "Incorrect", className: "border-red-400 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300" },
  skipped: { label: "Sans réponse", className: "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-300" },
  ungraded: { label: "Non corrigée", className: "border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950/30 dark:text-violet-300" },
};

export const fmtPoints = (n: number | null | undefined) => (n == null ? "—" : String(Math.round(n * 100) / 100).replace(".", ","));
