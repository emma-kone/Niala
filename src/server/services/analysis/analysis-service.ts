import type { Origin, Prisma } from "@prisma/client";
import { db, type DbTx } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { stitchChunks, type PageText } from "@/server/domain/chunking";
import { parseStructure, sectionTexts } from "@/server/domain/structure-parser";
import { AiCallError, AiQuotaError, AiUnavailableError, getProvider, isAiConfigured } from "@/server/ai/provider";
import { PROMPT_VERSION, batchSections, extractConcepts, inferStructure, type SectionExtraction, type SectionInput } from "./ai-services";

// ─────────────────────────────────────────────────────────────────────────────
// DocumentAnalysisService : orchestre structure (déterministe, sinon repli IA) puis notions (IA).
// Une analyse est liée à UNE version de document ; relancer crée une nouvelle analyse (l'historique
// est conservé). Ce qui est écrit dans le document (origin DOCUMENT) est séparé de ce qui est
// déduit (AI_INFERRED) ou ajouté par l'étudiant (USER).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HEADINGS = 400;
const MAX_AI_SECTIONS = 60;
const STALE_RUNNING_MS = 15 * 60_000;

export async function loadVersionPages(userId: string, versionId: string): Promise<PageText[]> {
  const chunks = await db.documentChunk.findMany({
    where: { versionId, userId },
    orderBy: { idx: "asc" },
    select: { idx: true, page: true, charStart: true, charEnd: true, content: true },
  });
  return stitchChunks(chunks);
}

export function pagesBetween(pages: PageText[], from: number | null, to: number | null): PageText[] {
  if (from == null) return pages;
  return pages.filter((p) => p.page != null && p.page >= from && p.page <= (to ?? from));
}

type Tx = DbTx;

/** Persiste notions, sources et relations d'une extraction de section. */
export async function saveExtraction(tx: Tx, userId: string, subjectId: string, analysisId: string, sectionId: string, ex: SectionExtraction) {
  const idByName = new Map<string, string>();
  for (const c of ex.concepts) {
    const existing = await tx.concept.findUnique({ where: { subjectId_normalizedName_kind: { subjectId, normalizedName: c.normalizedName, kind: c.kind } } });
    const concept =
      existing ??
      (await tx.concept.create({ data: { userId, subjectId, name: c.name, normalizedName: c.normalizedName, kind: c.kind, importance: c.importance } }));
    if (existing && c.importance > existing.importance) await tx.concept.update({ where: { id: existing.id }, data: { importance: c.importance } });
    if (!idByName.has(c.normalizedName)) idByName.set(c.normalizedName, concept.id);
    const dupe = await tx.conceptSource.findFirst({ where: { conceptId: concept.id, analysisId, sectionId } });
    if (!dupe) {
      await tx.conceptSource.create({
        data: {
          userId,
          conceptId: concept.id,
          analysisId,
          sectionId,
          origin: c.origin as Origin,
          definition: c.definition,
          refs: c.ref ? [c.ref] : undefined,
        },
      });
    }
  }
  for (const r of ex.relations) {
    const fromId = idByName.get(r.from);
    const toId = idByName.get(r.to);
    if (!fromId || !toId) continue;
    await tx.conceptRelation.upsert({
      where: { fromId_toId_type: { fromId, toId, type: r.type } },
      create: { userId, subjectId, fromId, toId, type: r.type, origin: r.origin as Origin },
      update: {},
    });
  }
}

export interface RunOptions {
  force?: boolean;
}

export async function runAnalysis(userId: string, documentId: string, opts: RunOptions = {}) {
  const doc = await db.document.findFirst({ where: { id: documentId, userId }, include: { currentVersion: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  if (!doc.subjectId) throw new ApiHttpError("Ce document n'est rattaché à aucune matière.", 409);
  const version = doc.currentVersion;
  if (!version || !["READY", "PARTIAL"].includes(version.extractStatus)) {
    throw new ApiHttpError("Le texte du document n'a pas pu être extrait : il ne peut pas être analysé.", 409);
  }
  const subjectId = doc.subjectId;

  // Cache : une analyse terminée avec la même version de prompt est réutilisée (aucun appel IA)
  const latest = await db.documentAnalysis.findFirst({ where: { userId, versionId: version.id }, orderBy: { createdAt: "desc" } });
  if (latest?.status === "RUNNING") {
    if (Date.now() - latest.createdAt.getTime() < STALE_RUNNING_MS) throw new ApiHttpError("Une analyse est déjà en cours pour ce document.", 409);
    await db.documentAnalysis.update({ where: { id: latest.id }, data: { status: "FAILED", error: "Analyse interrompue.", finishedAt: new Date() } });
  } else if (!opts.force && latest?.status === "READY" && latest.promptVersion === PROMPT_VERSION) {
    return { analysisId: latest.id, reused: true };
  }

  const pages = await loadVersionPages(userId, version.id);
  if (pages.every((p) => !p.text.trim())) throw new ApiHttpError("Aucun texte indexé pour ce document.", 409);

  const analysis = await db.documentAnalysis.create({
    data: { userId, versionId: version.id, status: "RUNNING", promptVersion: PROMPT_VERSION },
  });

  const notices: string[] = [];
  let model: string | null = null;
  try {
    // ── 1. Structure : numérotation du document (explicite), sinon repli IA (déduit) ──
    const parsed = parseStructure(pages);
    interface Node {
      numbering: string | null;
      label: string;
      level: number;
      parentIdx: number | null;
      pageStart: number | null;
      pageEnd: number | null;
      origin: Origin;
      refs: { page: number | null; quote: string }[] | null;
      text: string;
    }
    let nodes: Node[] = [];

    if (parsed.headings.length > 0) {
      const texts = sectionTexts(pages, parsed.headings);
      nodes = parsed.headings.slice(0, MAX_HEADINGS).map((h, i) => ({
        numbering: h.numbering,
        label: h.label,
        level: h.level,
        parentIdx: h.parentIndex,
        pageStart: texts[i].pageStart ?? h.page,
        pageEnd: texts[i].pageEnd ?? h.page,
        origin: "DOCUMENT" as Origin,
        refs: [{ page: h.page, quote: h.line }],
        text: texts[i].text,
      }));
      if (parsed.headings.length > MAX_HEADINGS) notices.push(`Plan tronqué à ${MAX_HEADINGS} titres.`);
    } else if (isAiConfigured()) {
      try {
        const inferred = await inferStructure(userId, pages);
        model = inferred.model;
        const stack: number[] = [];
        inferred.sections.forEach((s, i) => {
          stack.length = Math.min(stack.length, s.level);
          const level = stack.length; // niveau cohérent avec le parent retenu
          const next = inferred.sections[i + 1];
          const pageEnd = next?.page ? Math.max(next.page, s.page ?? next.page) : (pages.at(-1)?.page ?? s.page);
          const span = pagesBetween(pages, s.page, pageEnd);
          nodes.push({
            numbering: s.numbering,
            label: s.label,
            level,
            parentIdx: level ? stack[level - 1] : null,
            pageStart: s.page,
            pageEnd,
            origin: "AI_INFERRED",
            refs: null,
            text: span.map((p) => p.text).join("\n").slice(0, 8000),
          });
          stack[level] = i;
        });
        notices.push("Aucune numérotation détectée : le plan a été proposé par l'IA (à vérifier).");
      } catch (e) {
        if (e instanceof AiQuotaError) notices.push(e.message);
        else notices.push("Aucune numérotation détectée et le plan n'a pas pu être proposé par l'IA.");
      }
    } else {
      notices.push("Aucune numérotation détectable dans le document. Configurez le service d'IA pour qu'il propose un plan.");
    }

    // ── 2. Enregistrement du plan ──
    const ids: string[] = [];
    const positions = new Map<string, number>();
    await db.$transaction(async (tx) => {
      for (const n of nodes) {
        const parentId = n.parentIdx != null ? ids[n.parentIdx] : null;
        const key = parentId ?? "root";
        const position = positions.get(key) ?? 0;
        positions.set(key, position + 1);
        const created = await tx.courseSection.create({
          data: {
            userId,
            analysisId: analysis.id,
            parentId,
            label: n.label,
            numbering: n.numbering,
            level: parentId ? n.level : 0,
            position,
            pageStart: n.pageStart,
            pageEnd: n.pageEnd,
            origin: n.origin,
            refs: n.refs ?? undefined,
          },
        });
        ids.push(created.id);
      }
    }, { timeout: 30_000 });

    // ── 3. Notions (IA) ──
    if (nodes.length > 0 && isAiConfigured()) {
      const candidates = nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.text.replace(/\s/g, "").length >= 40);
      const limited = candidates.slice(0, MAX_AI_SECTIONS);
      if (candidates.length > limited.length) notices.push(`Notions extraites pour les ${MAX_AI_SECTIONS} premières sections seulement.`);
      const inputs: SectionInput[] = limited.map(({ n, i }) => ({
        key: i + 1,
        numbering: n.numbering,
        label: n.label,
        text: n.text,
        pages: pagesBetween(pages, n.pageStart, n.pageEnd),
      }));
      let failed = 0;
      for (const batch of batchSections(inputs)) {
        try {
          const { results, model: m } = await extractConcepts(userId, batch);
          model = m;
          await db.$transaction(async (tx) => {
            for (const r of results) await saveExtraction(tx, userId, subjectId, analysis.id, ids[r.key - 1], r);
          }, { timeout: 30_000 });
        } catch (e) {
          failed += batch.length;
          if (e instanceof AiQuotaError) {
            notices.push(e.message);
            break;
          }
          if (!(e instanceof AiCallError || e instanceof AiUnavailableError)) console.error("[analysis] lot", e);
        }
      }
      if (failed) notices.push(`${failed} section(s) n'ont pas pu être analysées : relancez-les individuellement.`);
    } else if (nodes.length > 0) {
      notices.push("Notions non extraites : le service d'IA n'est pas configuré. Le plan ci-dessous provient uniquement de la numérotation du document.");
    }

    await db.documentAnalysis.update({
      where: { id: analysis.id },
      data: { status: "READY", model: model ?? (getProvider()?.model ?? null), error: notices.join(" ") || null, finishedAt: new Date() },
    });
    return { analysisId: analysis.id, reused: false };
  } catch (e) {
    console.error("[analysis]", e);
    await db.documentAnalysis.update({ where: { id: analysis.id }, data: { status: "FAILED", error: "L'analyse a échoué. Réessayez.", finishedAt: new Date() } });
    throw new ApiHttpError("L'analyse a échoué. Réessayez.", 502);
  }
}

// ── Lecture ──────────────────────────────────────────────────────────────────

export async function getAnalysis(userId: string, documentId: string, analysisId?: string) {
  const doc = await db.document.findFirst({ where: { id: documentId, userId }, select: { id: true, currentVersionId: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const analyses = await db.documentAnalysis.findMany({
    where: { userId, version: { documentId } },
    orderBy: { createdAt: "desc" },
    include: { version: { select: { number: true } } },
    take: 50,
  });
  const base = {
    aiConfigured: isAiConfigured(),
    history: analyses.map((a) => ({ id: a.id, versionNumber: a.version.number, status: a.status, model: a.model, createdAt: a.createdAt })),
  };
  const chosen = analysisId ? analyses.find((a) => a.id === analysisId) : analyses[0];
  if (analysisId && !chosen) throw new ApiHttpError("Analyse introuvable.", 404);
  if (!chosen) return { ...base, analysis: null, sections: [], concepts: [], relations: [] };

  const [sections, sources] = await Promise.all([
    db.courseSection.findMany({ where: { analysisId: chosen.id, userId }, orderBy: [{ level: "asc" }, { position: "asc" }] }),
    db.conceptSource.findMany({ where: { analysisId: chosen.id, userId }, include: { concept: true }, orderBy: { id: "asc" } }),
  ]);
  const conceptIds = [...new Set(sources.map((s) => s.conceptId))];
  const relations = conceptIds.length
    ? await db.conceptRelation.findMany({ where: { userId, fromId: { in: conceptIds }, toId: { in: conceptIds } } })
    : [];
  return {
    ...base,
    analysis: {
      id: chosen.id,
      status: chosen.status,
      model: chosen.model,
      notice: chosen.error,
      createdAt: chosen.createdAt,
      finishedAt: chosen.finishedAt,
      versionNumber: analyses.find((a) => a.id === chosen.id)!.version.number,
      outdated: chosen.versionId !== doc.currentVersionId,
    },
    sections: sections.map((s) => ({
      id: s.id,
      parentId: s.parentId,
      label: s.label,
      numbering: s.numbering,
      level: s.level,
      position: s.position,
      pageStart: s.pageStart,
      pageEnd: s.pageEnd,
      origin: s.origin,
      edited: s.edited,
    })),
    concepts: sources.map((s) => ({
      id: s.id,
      conceptId: s.conceptId,
      sectionId: s.sectionId,
      name: s.concept.name,
      kind: s.concept.kind,
      importance: s.concept.importance,
      definition: s.definition,
      origin: s.origin,
      refs: (s.refs as { page: number | null; quote: string }[] | null) ?? [],
    })),
    relations: relations.map((r) => ({ id: r.id, fromId: r.fromId, toId: r.toId, type: r.type, origin: r.origin })),
  };
}
