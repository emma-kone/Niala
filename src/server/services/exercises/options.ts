import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { isAiConfigured } from "@/server/ai/provider";
import { maxQuestions } from "@/server/domain/exercise-model";
import { detectDocumentKind } from "@/server/domain/exercise-source";
import { loadVersionPages } from "@/server/services/analysis/analysis-service";

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
  // Un PDF scanné n'a pas de texte extrait : sans indice, il est traité comme un cours (l'étudiant peut changer).
  const text = version && ready ? (await loadVersionPages(userId, version.id)).map((p) => p.text).join("\n") : "";
  return {
    document: { id: doc.id, name: doc.name, subjectId: doc.subjectId, ready, pageCount: version?.pageCount ?? null, kind: detectDocumentKind(doc.name, text) },
    aiConfigured: isAiConfigured(),
    maxQuestions: maxQuestions(),
    analysis: analysis ? { id: analysis.id } : null,
    sections,
    concepts: [...uniq.values()].sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name)),
  };
}
