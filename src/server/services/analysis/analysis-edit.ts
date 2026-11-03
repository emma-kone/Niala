import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { foldText } from "@/server/ai/guard";
import { isAiConfigured } from "@/server/ai/provider";
import { extractConcepts } from "./ai-services";
import { loadVersionPages, pagesBetween, saveExtraction } from "./analysis-service";

// ─────────────────────────────────────────────────────────────────────────────
// Corrections de l'étudiant sur une analyse : titres, ordre, ajout/suppression, notions.
// Tout ce que l'étudiant modifie ou ajoute est marqué `USER`/`edited` ; il n'est jamais écrasé
// par une relance d'analyse partielle.
// ─────────────────────────────────────────────────────────────────────────────

type Tx = Prisma.TransactionClient;

async function ownedSection(tx: Tx | typeof db, userId: string, id: string) {
  const s = await tx.courseSection.findFirst({ where: { id, userId } });
  if (!s) throw new ApiHttpError("Section introuvable.", 404);
  return s;
}

async function siblings(tx: Tx, analysisId: string, parentId: string | null) {
  return tx.courseSection.findMany({ where: { analysisId, parentId }, orderBy: { position: "asc" } });
}

async function renumber(tx: Tx, analysisId: string, parentId: string | null) {
  const list = await siblings(tx, analysisId, parentId);
  for (let i = 0; i < list.length; i++) if (list[i].position !== i) await tx.courseSection.update({ where: { id: list[i].id }, data: { position: i } });
}

async function subtreeIds(tx: Tx, analysisId: string, rootId: string): Promise<string[]> {
  const all = await tx.courseSection.findMany({ where: { analysisId }, select: { id: true, parentId: true } });
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const c of all) if (c.parentId === out[i]) out.push(c.id);
  return out;
}

/** Supprime les notions sans aucune source, question ni maîtrise (évite les notions fantômes). */
async function pruneOrphanConcepts(tx: Tx, userId: string, subjectId: string) {
  await tx.concept.deleteMany({
    where: { userId, subjectId, sources: { none: {} }, questions: { none: {} }, mastery: null, nodes: { none: {} } },
  });
}

async function subjectOfAnalysis(tx: Tx | typeof db, userId: string, analysisId: string) {
  const a = await tx.documentAnalysis.findFirst({ where: { id: analysisId, userId }, select: { version: { select: { document: { select: { subjectId: true } } } } } });
  const subjectId = a?.version.document.subjectId;
  if (!subjectId) throw new ApiHttpError("Analyse introuvable.", 404);
  return subjectId;
}

export const sectionPatchSchema = z.object({ label: z.string().trim().min(1).max(160).optional(), numbering: z.string().trim().max(20).nullable().optional() });

export async function updateSection(userId: string, id: string, patch: z.infer<typeof sectionPatchSchema>) {
  await ownedSection(db, userId, id);
  await db.courseSection.update({ where: { id }, data: { ...patch, edited: true } });
  return { ok: true };
}

export async function addSection(userId: string, analysisId: string, input: { parentId: string | null; afterId?: string | null; label: string; numbering?: string | null }) {
  const subjectId = await subjectOfAnalysis(db, userId, analysisId);
  void subjectId;
  return db.$transaction(async (tx) => {
    let level = 0;
    if (input.parentId) {
      const parent = await ownedSection(tx, userId, input.parentId);
      if (parent.analysisId !== analysisId) throw new ApiHttpError("Section introuvable.", 404);
      if (parent.level >= 8) throw new ApiHttpError("Profondeur maximale atteinte.", 422);
      level = parent.level + 1;
    }
    const sibs = await siblings(tx, analysisId, input.parentId);
    let position = sibs.length;
    if (input.afterId) {
      const after = sibs.find((s) => s.id === input.afterId);
      if (!after) throw new ApiHttpError("Section introuvable.", 404);
      position = after.position + 1;
      for (const s of sibs) if (s.position >= position) await tx.courseSection.update({ where: { id: s.id }, data: { position: s.position + 1 } });
    }
    const created = await tx.courseSection.create({
      data: { userId, analysisId, parentId: input.parentId, label: input.label, numbering: input.numbering ?? null, level, position, origin: "USER", edited: true },
    });
    return { id: created.id };
  });
}

export async function deleteSection(userId: string, id: string) {
  const section = await ownedSection(db, userId, id);
  const subjectId = await subjectOfAnalysis(db, userId, section.analysisId);
  await db.$transaction(async (tx) => {
    const ids = await subtreeIds(tx, section.analysisId, id);
    await tx.conceptSource.deleteMany({ where: { analysisId: section.analysisId, sectionId: { in: ids } } });
    await tx.courseSection.delete({ where: { id } }); // les sous-sections sont supprimées en cascade
    await renumber(tx, section.analysisId, section.parentId);
    await pruneOrphanConcepts(tx, userId, subjectId);
  });
  return { ok: true };
}

export type MoveDirection = "up" | "down" | "indent" | "outdent";

export async function moveSection(userId: string, id: string, direction: MoveDirection) {
  const section = await ownedSection(db, userId, id);
  await db.$transaction(async (tx) => {
    const { analysisId } = section;
    const setLevels = async (rootId: string, delta: number) => {
      for (const sid of await subtreeIds(tx, analysisId, rootId)) {
        const s = await tx.courseSection.findUniqueOrThrow({ where: { id: sid } });
        await tx.courseSection.update({ where: { id: sid }, data: { level: s.level + delta } });
      }
    };
    const sibs = await siblings(tx, analysisId, section.parentId);
    const idx = sibs.findIndex((s) => s.id === id);

    if (direction === "up" || direction === "down") {
      const other = sibs[direction === "up" ? idx - 1 : idx + 1];
      if (!other) throw new ApiHttpError("Déplacement impossible.", 409);
      await tx.courseSection.update({ where: { id }, data: { position: other.position } });
      await tx.courseSection.update({ where: { id: other.id }, data: { position: section.position } });
    } else if (direction === "indent") {
      const prev = sibs[idx - 1];
      if (!prev) throw new ApiHttpError("Aucune section précédente sous laquelle ranger celle-ci.", 409);
      if (prev.level >= 8) throw new ApiHttpError("Profondeur maximale atteinte.", 422);
      const prevKids = await siblings(tx, analysisId, prev.id);
      await tx.courseSection.update({ where: { id }, data: { parentId: prev.id, position: prevKids.length, edited: true } });
      await setLevels(id, +1);
      await renumber(tx, analysisId, section.parentId);
    } else {
      if (!section.parentId) throw new ApiHttpError("Cette section est déjà au premier niveau.", 409);
      const parent = await tx.courseSection.findUniqueOrThrow({ where: { id: section.parentId } });
      const uncles = await siblings(tx, analysisId, parent.parentId);
      for (const u of uncles) if (u.position > parent.position) await tx.courseSection.update({ where: { id: u.id }, data: { position: u.position + 1 } });
      await tx.courseSection.update({ where: { id }, data: { parentId: parent.parentId, position: parent.position + 1, edited: true } });
      await setLevels(id, -1);
      await renumber(tx, analysisId, section.parentId);
      await renumber(tx, analysisId, parent.parentId);
    }
  });
  return { ok: true };
}

// ── Notions ──────────────────────────────────────────────────────────────────

export const conceptPatchSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  definition: z.string().trim().max(600).nullable().optional(),
  importance: z.number().int().min(1).max(3).optional(),
});

async function ownedSource(userId: string, id: string) {
  const src = await db.conceptSource.findFirst({ where: { id, userId }, include: { concept: true } });
  if (!src) throw new ApiHttpError("Notion introuvable.", 404);
  return src;
}

/** Correction d'une notion par l'étudiant : elle devient « ajoutée/corrigée par l'étudiant ». */
export async function updateConceptSource(userId: string, id: string, patch: z.infer<typeof conceptPatchSchema>) {
  const src = await ownedSource(userId, id);
  await db.$transaction(async (tx) => {
    if (patch.name !== undefined || patch.importance !== undefined) {
      const data: Prisma.ConceptUpdateInput = {};
      if (patch.importance !== undefined) data.importance = patch.importance;
      if (patch.name !== undefined) {
        const normalizedName = foldText(patch.name);
        if (!normalizedName) throw new ApiHttpError("Nom invalide.", 422);
        const clash = await tx.concept.findFirst({
          where: { subjectId: src.concept.subjectId, normalizedName, kind: src.concept.kind, id: { not: src.conceptId } },
        });
        if (clash) throw new ApiHttpError("Une notion de ce nom existe déjà dans la matière.", 409);
        data.name = patch.name;
        data.normalizedName = normalizedName;
      }
      await tx.concept.update({ where: { id: src.conceptId }, data });
    }
    await tx.conceptSource.update({
      where: { id },
      data: { origin: "USER", ...(patch.definition !== undefined ? { definition: patch.definition } : {}) },
    });
  });
  return { ok: true };
}

export async function deleteConceptSource(userId: string, id: string) {
  const src = await ownedSource(userId, id);
  await db.$transaction(async (tx) => {
    await tx.conceptSource.delete({ where: { id } });
    await pruneOrphanConcepts(tx, userId, src.concept.subjectId);
  });
  return { ok: true };
}

export const conceptInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["NOTION", "DEFINITION", "PROPERTY", "RULE", "EXAMPLE"]).default("NOTION"),
  definition: z.string().trim().max(600).optional(),
});

export async function addConcept(userId: string, sectionId: string, input: z.infer<typeof conceptInputSchema>) {
  const section = await ownedSection(db, userId, sectionId);
  const subjectId = await subjectOfAnalysis(db, userId, section.analysisId);
  const normalizedName = foldText(input.name);
  if (!normalizedName) throw new ApiHttpError("Nom invalide.", 422);
  return db.$transaction(async (tx) => {
    const concept =
      (await tx.concept.findUnique({ where: { subjectId_normalizedName_kind: { subjectId, normalizedName, kind: input.kind } } })) ??
      (await tx.concept.create({ data: { userId, subjectId, name: input.name, normalizedName, kind: input.kind } }));
    const dupe = await tx.conceptSource.findFirst({ where: { conceptId: concept.id, analysisId: section.analysisId, sectionId } });
    if (dupe) throw new ApiHttpError("Cette notion existe déjà dans la section.", 409);
    const src = await tx.conceptSource.create({
      data: { userId, conceptId: concept.id, analysisId: section.analysisId, sectionId, origin: "USER", definition: input.definition ?? null },
    });
    return { id: src.id };
  });
}

/** Relance l'extraction d'UNE section : remplace les notions issues du document/de l'IA, garde celles de l'étudiant. */
export async function reanalyzeSection(userId: string, sectionId: string) {
  if (!isAiConfigured()) throw new ApiHttpError("Le service d'IA n'est pas configuré.", 503);
  const section = await ownedSection(db, userId, sectionId);
  const analysis = await db.documentAnalysis.findFirstOrThrow({
    where: { id: section.analysisId, userId },
    include: { version: { select: { id: true, document: { select: { subjectId: true } } } } },
  });
  const subjectId = analysis.version.document.subjectId;
  if (!subjectId) throw new ApiHttpError("Analyse introuvable.", 404);

  const pages = await loadVersionPages(userId, analysis.version.id);
  const span = pagesBetween(pages, section.pageStart, section.pageEnd);
  // Texte de la section : pages couvertes ; si le titre d'origine est connu, on part de sa ligne
  const full = span.map((p) => p.text).join("\n");
  const quote = (section.refs as { quote?: string }[] | null)?.[0]?.quote;
  const startAt = quote ? full.indexOf(quote) : -1;
  const text = (startAt >= 0 ? full.slice(startAt) : full).slice(0, 8000);
  if (text.replace(/\s/g, "").length < 40) throw new ApiHttpError("Cette section ne contient pas assez de texte à analyser.", 409);

  const { results } = await extractConcepts(userId, [{ key: 1, numbering: section.numbering, label: section.label, text, pages: span }]);
  await db.$transaction(async (tx) => {
    await tx.conceptSource.deleteMany({ where: { sectionId, analysisId: section.analysisId, origin: { not: "USER" } } });
    await saveExtraction(tx, userId, subjectId, section.analysisId, sectionId, results[0]);
    await pruneOrphanConcepts(tx, userId, subjectId);
  });
  return { ok: true };
}
