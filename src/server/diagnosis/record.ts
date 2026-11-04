import type { ErrorCategory, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { buildReport, type Activity, type EngineInput, type Report } from "./engine";
import { skillForKind } from "@/server/domain/skills";

// Persistance du diagnostic : UN point d'écriture pour toutes les activités (exercices, éditeur, SQL).
// Le rapport est la vue normalisée ; les lignes ErrorDiagnosis restent les observations par catégorie.

export interface ReportDto extends Report {
  id: string;
  createdAt: Date;
}

export interface HistoryQuery {
  userId: string;
  category?: ErrorCategory | null;
  /** Espace de travail (éditeur / SQL). */
  workspaceId?: string;
  /** Notion (exercices). */
  conceptId?: string | null;
  excludeLabRunId?: string;
  excludeAnswerId?: string;
}

/** Ce que l'historique permet d'affirmer : récurrence de la même catégorie, réussites antérieures, indices utilisés. */
export async function loadHistory(q: HistoryQuery): Promise<NonNullable<EngineInput["history"]>> {
  let sameCategory = 0;
  let priorSuccesses = 0;
  let hintsUsed = 0;
  if (q.workspaceId) {
    const runs = await db.labRun.findMany({ where: { userId: q.userId, workspaceId: q.workspaceId, ...(q.excludeLabRunId ? { id: { not: q.excludeLabRunId } } : {}) }, orderBy: { createdAt: "desc" }, take: 30, select: { tests: true, evaluation: true } });
    for (const r of runs) {
      if ((r.tests as { summary?: { allPassed?: boolean } } | null)?.summary?.allPassed) priorSuccesses++;
      hintsUsed += ((r.evaluation as { hints?: unknown[] } | null)?.hints ?? []).length;
    }
    if (q.category) sameCategory = await db.errorDiagnosis.count({ where: { userId: q.userId, category: q.category, labRun: { workspaceId: q.workspaceId, ...(q.excludeLabRunId ? { id: { not: q.excludeLabRunId } } : {}) } } });
  } else if (q.conceptId) {
    if (q.category) sameCategory = await db.errorDiagnosis.count({ where: { userId: q.userId, conceptId: q.conceptId, category: q.category, ...(q.excludeAnswerId ? { answerId: { not: q.excludeAnswerId } } : {}) } });
    priorSuccesses = await db.answer.count({ where: { userId: q.userId, verdict: "correct", attempt: { exercise: { questions: { some: { concepts: { some: { conceptId: q.conceptId } } } } } } } });
  }
  return { sameCategory, priorSuccesses, hintsUsed };
}

export interface RecordInput {
  userId: string;
  activity: Activity;
  answerId?: string;
  labRunId?: string;
  subjectId?: string | null;
  language?: string;
  engine: EngineInput;
  /** Charge l'historique pour la catégorie établie (deuxième passe du moteur). */
  history?: (category: ErrorCategory | null) => Promise<NonNullable<EngineInput["history"]>>;
}

/** Construit le diagnostic à partir des constats des outils, puis l'enregistre (remplace celui de la même réponse). */
export async function recordDiagnosis(input: RecordInput): Promise<ReportDto> {
  let engineInput = input.engine;
  if (input.history) {
    const first = buildReport(engineInput);
    engineInput = { ...engineInput, history: await input.history(first.primary as ErrorCategory | null) };
  }
  const report = buildReport(engineInput);
  if (input.answerId) await db.diagnosisReport.deleteMany({ where: { userId: input.userId, answerId: input.answerId } });
  const row = await db.diagnosisReport.create({
    data: {
      userId: input.userId,
      activity: input.activity,
      answerId: input.answerId ?? null,
      labRunId: input.labRunId ?? null,
      subjectId: input.subjectId ?? null,
      language: input.language ?? null,
      primary: report.primary as ErrorCategory | null,
      secondary: report.secondary as unknown as Prisma.InputJsonValue,
      state: report.state,
      summary: report.summary,
      evidence: report.evidence as unknown as Prisma.InputJsonValue,
      expected: (report.expected ?? undefined) as Prisma.InputJsonValue | undefined,
      observed: (report.observed ?? undefined) as Prisma.InputJsonValue | undefined,
      concepts: report.concepts as unknown as Prisma.InputJsonValue,
      prerequisites: report.prerequisites as unknown as Prisma.InputJsonValue,
      severity: report.severity,
      confidence: report.confidence,
      pedagogical: report.pedagogical,
      recommendedAction: report.recommendedAction,
      needsVerification: report.needsVerification,
      source: report.source,
      engineVersion: report.engineVersion,
      facts: { status: engineInput.status, tests: engineInput.tests ?? null, history: engineInput.history ?? null, error: engineInput.error ?? null } as unknown as Prisma.InputJsonValue,
    },
  });
  // Observations par compétence (code, SQL et calcul) : base des difficultés récurrentes entre activités et langages.
  // Les réponses conceptuelles d'exercices sont rattachées à leur notion, pas à une compétence de programmation.
  if (report.pedagogical && report.state !== "NONE") {
    const skills = new Set<string>();
    for (const d of input.engine.diagnoses) {
      if (input.activity === "EXERCISE" && d.kind !== "numeric") continue;
      const info = input.activity === "EXERCISE" ? { key: "calcul" } : skillForKind(d.kind);
      if (info) skills.add(info.key);
    }
    if (skills.size) {
      await db.skillObservation.createMany({
        data: [...skills].map((skill) => ({ userId: input.userId, skill, activity: input.activity, language: input.language || null, category: report.primary as ErrorCategory | null, conceptId: input.engine.concepts[0]?.id ?? null, reportId: row.id })),
      });
    }
  }
  return { ...report, id: row.id, createdAt: row.createdAt };
}

/** Notions prérequises (relation PREREQUISITE entrante) avec leur maîtrise MESURÉE : seules ces mesures peuvent désigner un prérequis fragile. */
export async function loadPrerequisites(userId: string, conceptId: string | null | undefined): Promise<{ name: string; level: number; confidence: number }[]> {
  if (!conceptId) return [];
  const rels = await db.conceptRelation.findMany({ where: { userId, toId: conceptId, type: "PREREQUISITE" }, include: { from: { include: { mastery: true } } }, take: 20 });
  return rels.map((r) => ({ name: r.from.name, level: r.from.mastery?.level ?? 0, confidence: r.from.mastery?.confidence ?? 0 }));
}
