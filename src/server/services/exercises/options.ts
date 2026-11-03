import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { isAiConfigured } from "@/server/ai/provider";
import { maxQuestions } from "@/server/domain/exercise-model";

export async function getExerciseOptions(userId: string, documentId: string) {
  const doc = await db.document.findFirst({ where: { id: documentId, userId }, include: { currentVersion: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const version = doc.currentVersion;
  const ready = !!version && ["READY", "PARTIAL"].includes(version.extractStatus);
  const analysis = version ? await db.documentAnalysis.findFirst({ where: { userId, versionId: version.id, status: "READY" }, orderBy: { createdAt: "desc" } }) : null;
  const [sections, concepts] = analysis
    ? await Promise.all([
        db.courseSection.findMany({ where: { analysisId: analysis.id, userId }, orderBy: [{ level: "asc" }, { position: "asc" }], select: { id: true, label: true, numbering: true, level: true, parentId: true, position: true } }),
        db.conceptSource.findMany({ where: { analysisId: analysis.id, userId }, include: { concept: { select: { id: true, name: true, importance: true } } } }),
      ])
    : [[], []];
  const uniq = new Map(concepts.map((c) => [c.concept.id, c.concept]));
  return {
    document: { id: doc.id, name: doc.name, subjectId: doc.subjectId, ready, pageCount: version?.pageCount ?? null },
    aiConfigured: isAiConfigured(),
    maxQuestions: maxQuestions(),
    analysis: analysis ? { id: analysis.id } : null,
    sections,
    concepts: [...uniq.values()].sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name)),
  };
}
