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

export interface SourceCandidate {
  id: string;
  name: string;
  subjectId: string | null;
  subjectName: string | null;
  kind: string;
  pageCount: number | null;
  /** Les sections et notions ne peuvent être choisies que si le document a été analysé. */
  analyzed: boolean;
}

/** Documents que l'étudiant peut choisir comme sources d'un exercice : propriétaire seulement, texte extrait. */
export async function listSourceCandidates(userId: string): Promise<SourceCandidate[]> {
  const docs = await db.document.findMany({
    where: { userId, currentVersion: { is: { extractStatus: { in: ["READY", "PARTIAL"] } } } },
    select: { id: true, name: true, type: true, subjectId: true, subject: { select: { name: true } }, currentVersion: { select: { id: true, pageCount: true } } },
    orderBy: [{ subjectId: "asc" }, { name: "asc" }],
    take: 500,
  });
  const analyzed = new Set(
    (await db.documentAnalysis.findMany({ where: { userId, status: "READY", versionId: { in: docs.map((d) => d.currentVersion!.id) } }, select: { versionId: true } })).map((a) => a.versionId)
  );
  return docs.map((d) => ({ id: d.id, name: d.name, subjectId: d.subjectId, subjectName: d.subject?.name ?? null, kind: d.type, pageCount: d.currentVersion!.pageCount, analyzed: analyzed.has(d.currentVersion!.id) }));
}
