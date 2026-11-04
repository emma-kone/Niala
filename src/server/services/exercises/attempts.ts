import { z } from "zod";
import type { ErrorCategory, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import type { QuestionType } from "@/server/domain/exercise-model";
import { gradeAnswer } from "./evaluation";
import { loadHistory, recordDiagnosis } from "@/server/diagnosis/record";
import { refreshProgress } from "@/server/services/progress/progress";

// ─────────────────────────────────────────────────────────────────────────────
// Tentatives : copie FIGÉE de l'exercice (snapshot), réponses enregistrées au fil de l'eau (reprise),
// correction à la soumission. Les clés de correction ne sont jamais envoyées avant la correction.
// ─────────────────────────────────────────────────────────────────────────────

interface SnapshotQuestion {
  position: number;
  type: QuestionType;
  points: number;
  difficulty: string;
  payload: Record<string, unknown>;
  answerKey: Record<string, unknown>;
  explanation: string | null;
  sourceRefs: { quote: string; page: number | null }[];
  concepts: { id: string; name: string }[];
}
interface Snapshot {
  exercise: { id: string; title: string; totalPoints: number; documentId: string | null; documentName: string | null; versionId: string | null; versionNumber: number | null; subjectId: string };
  questions: SnapshotQuestion[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function startAttempt(userId: string, exerciseId: string, opts: { fresh?: boolean } = {}) {
  const exercise = await db.exercise.findFirst({
    where: { id: exerciseId, userId },
    include: {
      questions: { orderBy: { position: "asc" }, include: { concepts: { include: { concept: { select: { id: true, name: true } } } } } },
      document: { select: { id: true, name: true } },
      version: { select: { id: true, number: true } },
    },
  });
  if (!exercise) throw new ApiHttpError("Exercice introuvable.", 404);
  if (exercise.questions.length === 0) throw new ApiHttpError("Cet exercice ne contient aucune question.", 409);

  if (!opts.fresh) {
    const open = await db.exerciseAttempt.findFirst({ where: { userId, exerciseId, status: "IN_PROGRESS" }, orderBy: { startedAt: "desc" } });
    if (open) return { id: open.id, resumed: true };
  }
  const snapshot: Snapshot = {
    exercise: {
      id: exercise.id,
      title: exercise.title,
      totalPoints: exercise.totalPoints,
      documentId: exercise.documentId,
      documentName: exercise.document?.name ?? null,
      versionId: exercise.versionId,
      versionNumber: exercise.version?.number ?? null,
      subjectId: exercise.subjectId,
    },
    questions: exercise.questions.map((q) => ({
      position: q.position,
      type: q.type as QuestionType,
      points: q.points,
      difficulty: q.difficulty,
      payload: q.payload as Record<string, unknown>,
      answerKey: q.answerKey as Record<string, unknown>,
      explanation: q.explanation,
      sourceRefs: (q.sourceRefs as Snapshot["questions"][number]["sourceRefs"] | null) ?? [],
      concepts: q.concepts.map((c) => c.concept),
    })),
  };
  const attempt = await db.exerciseAttempt.create({
    data: { userId, exerciseId, snapshot: snapshot as unknown as Prisma.InputJsonValue, maxScore: exercise.totalPoints },
  });
  await db.learningActivity.create({
    data: { userId, subjectId: exercise.subjectId, type: "EXERCISE", refType: "attempt", refId: attempt.id, title: exercise.title, status: "IN_PROGRESS", lastPosition: { position: 1 } },
  });
  return { id: attempt.id, resumed: false };
}

async function ownedAttempt(userId: string, id: string) {
  const a = await db.exerciseAttempt.findFirst({ where: { id, userId }, include: { answers: true } });
  if (!a) throw new ApiHttpError("Tentative introuvable.", 404);
  return a;
}

type FeedbackJson = {
  verdict: string;
  points: number | null;
  max: number;
  expected: unknown;
  detail?: Record<string, unknown>;
  explanation: string | null;
  method: string;
};

export interface AttemptQuestionDto {
  position: number;
  type: QuestionType;
  points: number;
  difficulty: string;
  payload: Record<string, unknown>;
  answer: unknown;
  /** Présents uniquement une fois la tentative corrigée. */
  result?: (FeedbackJson & { questionExplanation: string | null }) | null;
  sourceRefs?: { quote: string; page: number | null }[];
  concepts?: { id: string; name: string }[];
}

export async function getAttempt(userId: string, id: string) {
  const a = await ownedAttempt(userId, id);
  const snap = a.snapshot as unknown as Snapshot;
  const graded = a.status === "GRADED";
  const answerOf = new Map(a.answers.map((x) => [x.position, x]));

  const questions: AttemptQuestionDto[] = snap.questions.map((q) => {
    const ans = answerOf.get(q.position);
    const base: AttemptQuestionDto = {
      position: q.position,
      type: q.type,
      points: q.points,
      difficulty: q.difficulty,
      payload: q.payload,
      answer: ans?.value ?? null,
    };
    if (!graded) return base;
    const fb = (ans?.feedback as FeedbackJson | null) ?? null;
    return {
      ...base,
      result: fb ? { ...fb, explanation: fb.explanation ?? q.explanation, questionExplanation: q.explanation } : null,
      sourceRefs: q.sourceRefs,
      concepts: q.concepts,
    };
  });
  const results = graded ? questions : [];
  const ungraded = graded ? snap.questions.filter((q) => (answerOf.get(q.position)?.verdict ?? "ungraded") === "ungraded").length : 0;
  return {
    id: a.id,
    status: a.status,
    exercise: snap.exercise,
    startedAt: a.startedAt,
    finishedAt: a.finishedAt,
    lastPosition: a.lastPosition,
    score: a.score,
    maxScore: a.maxScore,
    ungraded,
    gradedMax: graded ? round(snap.questions.filter((q) => (answerOf.get(q.position)?.verdict ?? "ungraded") !== "ungraded").reduce((s, q) => s + q.points, 0)) : null,
    questions,
    summary: graded ? { results: results.length } : null,
  };
}

// ── Réponses ─────────────────────────────────────────────────────────────────

const str = (max: number) => z.string().max(max);
const valueSchemas: Record<QuestionType, z.ZodType> = {
  qcm_single: str(64).nullable(),
  qcm_multiple: z.array(str(64)).max(10),
  true_false: z.boolean().nullable(),
  fill_choices: z.record(str(64), str(300)).refine((o) => Object.keys(o).length <= 8),
  fill_blank: z.record(str(64), str(300)).refine((o) => Object.keys(o).length <= 8),
  short_answer: str(600).nullable(),
  definition: str(4000).nullable(),
  open: str(8000).nullable(),
  matching: z.record(str(64), str(64)).refine((o) => Object.keys(o).length <= 8),
  practical: str(8000).nullable(),
  code: str(12000).nullable(),
  sql: str(12000).nullable(),
};

export async function saveAnswer(userId: string, attemptId: string, position: number, value: unknown) {
  const a = await ownedAttempt(userId, attemptId);
  if (a.status !== "IN_PROGRESS") throw new ApiHttpError("Cette tentative est terminée : les réponses ne peuvent plus être modifiées.", 409);
  const q = (a.snapshot as unknown as Snapshot).questions.find((x) => x.position === position);
  if (!q) throw new ApiHttpError("Question introuvable.", 404);
  const parsed = valueSchemas[q.type].safeParse(value);
  if (!parsed.success) throw new ApiHttpError("Réponse invalide pour ce type de question.", 422);
  await db.$transaction([
    db.answer.upsert({
      where: { attemptId_position: { attemptId, position } },
      create: { userId, attemptId, position, value: parsed.data as Prisma.InputJsonValue },
      update: { value: parsed.data as Prisma.InputJsonValue },
    }),
    db.exerciseAttempt.update({ where: { id: attemptId }, data: { lastPosition: position } }),
    db.learningActivity.updateMany({ where: { userId, refType: "attempt", refId: attemptId }, data: { lastPosition: { position } } }),
  ]);
  return { ok: true };
}

// ── Correction ───────────────────────────────────────────────────────────────

async function gradePositions(userId: string, a: Awaited<ReturnType<typeof ownedAttempt>>, only?: Set<number>) {
  const snap = a.snapshot as unknown as Snapshot;
  const answers = new Map(a.answers.map((x) => [x.position, x]));
  for (const q of snap.questions) {
    if (only && !only.has(q.position)) continue;
    const prev = answers.get(q.position);
    const g = await gradeAnswer(userId, q, prev?.value ?? null);
    const feedback: FeedbackJson = { verdict: g.verdict, points: g.points, max: q.points, expected: g.expected, detail: g.detail, explanation: g.explanation, method: g.method };
    const data = {
      value: (prev?.value ?? null) as Prisma.InputJsonValue,
      feedback: feedback as unknown as Prisma.InputJsonValue,
      verdict: g.verdict,
      points: g.points,
      gradedBy: g.method === "ai" ? ("AI" as const) : ("RULE" as const),
    };
    const saved = await db.answer.upsert({
      where: { attemptId_position: { attemptId: a.id, position: q.position } },
      create: { userId, attemptId: a.id, position: q.position, ...data, value: (prev?.value ?? "") as Prisma.InputJsonValue },
      update: data,
    });
    // Diagnostic d'erreur (code/SQL exécutés) : remplacé à chaque correction, justifié par les tests concernés.
    const diagnoses = (g.detail?.diagnoses ?? []) as { category: ErrorCategory; kind: string; confidence: number; label: string; tests: string[] }[];
    await db.errorDiagnosis.deleteMany({ where: { userId, answerId: saved.id } });
    if (diagnoses.length) {
      await db.errorDiagnosis.createMany({
        data: diagnoses.map((d) => ({ userId, answerId: saved.id, conceptId: q.concepts[0]?.id ?? null, category: d.category, confidence: d.confidence, evidence: { source: "tests", kind: d.kind, label: d.label, tests: d.tests, questionPosition: q.position } as unknown as Prisma.InputJsonValue })),
      });
    }
    // Diagnostic unifié des questions de code et de SQL exécutées (les autres types viendront avec leur analyseur).
    await db.diagnosisReport.deleteMany({ where: { userId, answerId: saved.id } });
    if ((q.type === "code" || q.type === "sql") && g.detail?.executed) {
      const summary = g.detail.summary as { passed: number; total: number; edgePassed: number; edgeTotal: number } | undefined;
      await recordDiagnosis({
        userId,
        activity: q.type === "sql" ? "SQL" : "CODE",
        answerId: saved.id,
        subjectId: snap.exercise.subjectId,
        language: String(q.payload.language ?? (q.type === "sql" ? "sql" : "")),
        engine: {
          activity: q.type === "sql" ? "SQL" : "CODE",
          language: String(q.payload.language ?? ""),
          status: g.verdict === "correct" ? "pass" : "fail",
          diagnoses: diagnoses as never,
          tests: summary ? { passed: summary.passed, total: summary.total, edgePassed: summary.edgePassed, edgeTotal: summary.edgeTotal } : undefined,
          concepts: q.concepts.map((c) => ({ id: c.id, name: c.name })),
        },
        history: (category) => loadHistory({ userId, category, conceptId: q.concepts[0]?.id ?? null, excludeAnswerId: saved.id }),
      });
    }
  }
}

async function finalize(userId: string, attemptId: string) {
  const a = await ownedAttempt(userId, attemptId);
  const score = round(a.answers.reduce((s, x) => s + (x.points ?? 0), 0));
  await db.$transaction([
    db.exerciseAttempt.update({
      where: { id: attemptId },
      data: { status: "GRADED", finishedAt: a.finishedAt ?? new Date(), score, durationSec: a.durationSec ?? Math.max(1, Math.round((Date.now() - a.startedAt.getTime()) / 1000)) },
    }),
    db.learningActivity.updateMany({ where: { userId, refType: "attempt", refId: attemptId }, data: { status: "DONE" } }),
  ]);
  await refreshProgress(userId); // maîtrise par notion + recommandations (n'échoue jamais la correction)
}

/** Soumission : fige la tentative puis corrige. Idempotente (une seconde soumission renvoie la correction existante). */
export async function submitAttempt(userId: string, attemptId: string) {
  const claim = await db.exerciseAttempt.updateMany({ where: { id: attemptId, userId, status: "IN_PROGRESS" }, data: { status: "SUBMITTED" } });
  if (claim.count === 0) {
    const existing = await ownedAttempt(userId, attemptId);
    if (existing.status === "SUBMITTED") throw new ApiHttpError("La correction de cette tentative est en cours.", 409);
    return getAttempt(userId, attemptId);
  }
  try {
    await gradePositions(userId, await ownedAttempt(userId, attemptId));
    await finalize(userId, attemptId);
  } catch (e) {
    // La correction a échoué : la tentative redevient modifiable, aucune réponse n'est perdue
    await db.exerciseAttempt.updateMany({ where: { id: attemptId, userId, status: "SUBMITTED" }, data: { status: "IN_PROGRESS" } });
    throw e;
  }
  return getAttempt(userId, attemptId);
}

/** Corrige les questions restées « non corrigées » (service d'IA indisponible à la soumission). */
export async function regradePending(userId: string, attemptId: string) {
  const a = await ownedAttempt(userId, attemptId);
  if (a.status !== "GRADED") throw new ApiHttpError("La tentative n'est pas encore corrigée.", 409);
  const pending = new Set(a.answers.filter((x) => x.verdict === "ungraded").map((x) => x.position));
  if (pending.size === 0) return getAttempt(userId, attemptId);
  await gradePositions(userId, a, pending);
  await finalize(userId, attemptId);
  return getAttempt(userId, attemptId);
}

export async function listAttempts(userId: string, exerciseId: string) {
  const exists = await db.exercise.count({ where: { id: exerciseId, userId } });
  if (!exists) throw new ApiHttpError("Exercice introuvable.", 404);
  const attempts = await db.exerciseAttempt.findMany({ where: { userId, exerciseId }, orderBy: { startedAt: "desc" }, include: { _count: { select: { answers: true } } }, take: 100 });
  return attempts.map((a) => ({ id: a.id, status: a.status, score: a.score, maxScore: a.maxScore, startedAt: a.startedAt, finishedAt: a.finishedAt, durationSec: a.durationSec, answered: a._count.answers }));
}

// ── Exercices ────────────────────────────────────────────────────────────────

export async function listExercises(userId: string, filter: { subjectId?: string; documentId?: string }) {
  const rows = await db.exercise.findMany({
    where: { userId, ...(filter.subjectId ? { subjectId: filter.subjectId } : {}), ...(filter.documentId ? { documentId: filter.documentId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      subject: { select: { id: true, name: true, color: true } },
      document: { select: { id: true, name: true } },
      version: { select: { number: true } },
      _count: { select: { questions: true } },
      attempts: { select: { id: true, status: true, score: true, maxScore: true, startedAt: true }, orderBy: { startedAt: "desc" } },
    },
  });
  return rows.map((e) => {
    const graded = e.attempts.filter((a) => a.status === "GRADED" && a.score != null);
    return {
      id: e.id,
      title: e.title,
      subject: e.subject,
      document: e.document,
      versionNumber: e.version?.number ?? null,
      createdAt: e.createdAt,
      totalPoints: e.totalPoints,
      questions: e._count.questions,
      attempts: e.attempts.length,
      inProgress: e.attempts.find((a) => a.status === "IN_PROGRESS")?.id ?? null,
      best: graded.length ? Math.max(...graded.map((a) => a.score!)) : null,
      last: graded[0]?.score ?? null,
      notice: ((e.config as { notice?: string | null } | null)?.notice) ?? null,
    };
  });
}

export async function getExercise(userId: string, id: string) {
  const e = await db.exercise.findFirst({
    where: { id, userId },
    include: {
      questions: { orderBy: { position: "asc" }, select: { position: true, type: true, points: true, difficulty: true } },
      subject: { select: { id: true, name: true, color: true } },
      document: { select: { id: true, name: true } },
      version: { select: { number: true } },
    },
  });
  if (!e) throw new ApiHttpError("Exercice introuvable.", 404);
  const cfg = e.config as { notice?: string | null; requested?: number; questionCount?: number; types?: string[]; difficulty?: string; coverage?: { mode: string } };
  return {
    id: e.id,
    title: e.title,
    subject: e.subject,
    document: e.document,
    versionNumber: e.version?.number ?? null,
    createdAt: e.createdAt,
    totalPoints: e.totalPoints,
    notice: cfg.notice ?? null,
    requested: cfg.questionCount ?? null,
    config: { types: cfg.types ?? [], difficulty: cfg.difficulty ?? null, coverage: cfg.coverage?.mode ?? null },
    questions: e.questions,
    attempts: await listAttempts(userId, id),
  };
}

export async function deleteExercise(userId: string, id: string) {
  const res = await db.exercise.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new ApiHttpError("Exercice introuvable.", 404);
  return { ok: true };
}
