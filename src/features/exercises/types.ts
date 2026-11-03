import type { QuestionType } from "@/server/domain/exercise-types";

export interface ExerciseListItem {
  id: string;
  title: string;
  subject: { id: string; name: string; color: string };
  document: { id: string; name: string } | null;
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
  subject: { id: string; name: string; color: string };
  document: { id: string; name: string } | null;
  versionNumber: number | null;
  createdAt: string;
  totalPoints: number;
  notice: string | null;
  requested: number | null;
  config: { types: string[]; difficulty: string | null; coverage: string | null };
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
  sourceRefs?: { quote: string; page: number | null }[];
  concepts?: { id: string; name: string }[];
}

export interface AttemptDetail {
  id: string;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  exercise: { id: string; title: string; totalPoints: number; documentId: string | null; documentName: string | null; versionNumber: number | null; subjectId: string };
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
  document: { id: string; name: string; subjectId: string | null; ready: boolean; pageCount: number | null };
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
