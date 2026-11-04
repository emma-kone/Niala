import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { getProvider } from "@/server/ai/provider";
import { stitchChunks } from "@/server/domain/chunking";
import { computeCoverage, dot, fuseRankings, lexicalScore, queryTerms, type Coverage } from "@/server/domain/retrieval";

// ─────────────────────────────────────────────────────────────────────────────
// Consultation des documents pour le chat : TOUJOURS bornée au propriétaire et à la VERSION COURANTE
// de chaque document. Aucune fonction ici ne reçoit un identifiant sans le filtrer par utilisateur.
// ─────────────────────────────────────────────────────────────────────────────

export interface Scope {
  /** Restreint à ces documents (conversation de document : un seul). */
  documentIds?: string[];
  /** Restreint à une matière (conversation globale ciblée). */
  subjectId?: string | null;
}

export interface DocInfo {
  id: string;
  name: string;
  versionId: string;
  subjectId: string | null;
  pageCount: number | null;
  extractStatus: string;
  extractWarnings: string[];
}

export interface Hit {
  chunkId: string;
  documentId: string;
  documentName: string;
  subjectId: string | null;
  versionId: string;
  page: number | null;
  section: string | null;
  content: string;
}

const SEARCHABLE = ["READY", "PARTIAL"] as const;

/** Documents consultables (version courante extraite) dans le périmètre demandé. */
export async function resolveDocs(userId: string, scope: Scope): Promise<DocInfo[]> {
  const docs = await db.document.findMany({
    where: {
      userId,
      ...(scope.documentIds ? { id: { in: scope.documentIds } } : {}),
      ...(scope.subjectId ? { subjectId: scope.subjectId } : {}),
      currentVersion: { is: { extractStatus: { in: [...SEARCHABLE] } } },
    },
    select: { id: true, name: true, subjectId: true, currentVersion: { select: { id: true, pageCount: true, extractStatus: true, extractWarnings: true } } },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  return docs
    .filter((d) => d.currentVersion)
    .map((d) => ({
      id: d.id,
      name: d.name,
      versionId: d.currentVersion!.id,
      subjectId: d.subjectId,
      pageCount: d.currentVersion!.pageCount,
      extractStatus: d.currentVersion!.extractStatus,
      extractWarnings: Array.isArray(d.currentVersion!.extractWarnings) ? (d.currentVersion!.extractWarnings as string[]) : [],
    }));
}

async function sectionsFor(userId: string, versionId: string) {
  const analysis = await db.documentAnalysis.findFirst({ where: { userId, versionId, status: "READY" }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!analysis) return [];
  return db.courseSection.findMany({
    where: { analysisId: analysis.id, userId },
    orderBy: [{ level: "asc" }, { position: "asc" }],
    select: { label: true, numbering: true, level: true, pageStart: true, pageEnd: true },
  });
}

type Section = Awaited<ReturnType<typeof sectionsFor>>[number];

/** Section la plus précise (la plus profonde) qui contient la page. */
function sectionLabel(sections: Section[], page: number | null): string | null {
  if (page == null) return null;
  let best: Section | null = null;
  for (const s of sections) if (s.pageStart != null && page >= s.pageStart && page <= (s.pageEnd ?? s.pageStart) && (!best || s.level >= best.level)) best = s;
  return best ? [best.numbering, best.label].filter(Boolean).join(" ") : null;
}

/** Plan du document (analyse la plus récente) : sert à se repérer avant de lire. */
export async function outline(userId: string, documentId: string) {
  const [doc] = await resolveDocs(userId, { documentIds: [documentId] });
  if (!doc) throw new ApiHttpError("Document introuvable ou pas encore extrait.", 404);
  const sections = await sectionsFor(userId, doc.versionId);
  return { document: doc.name, sections: sections.slice(0, 120).map((s) => ({ niveau: s.level, titre: [s.numbering, s.label].filter(Boolean).join(" "), pages: s.pageStart ? `${s.pageStart}${s.pageEnd && s.pageEnd !== s.pageStart ? `–${s.pageEnd}` : ""}` : null })) };
}

/** Recherche hybride (mots-clés + vecteurs) dans le périmètre. */
export async function searchPassages(userId: string, scope: Scope, question: string, limit = 8, signal?: AbortSignal): Promise<Hit[]> {
  const docs = await resolveDocs(userId, scope);
  if (!docs.length) return [];
  const versionIds = docs.map((d) => d.versionId);
  const byVersion = new Map(docs.map((d) => [d.versionId, d]));

  // 1. Lexical : candidats filtrés en base, classés ici
  const terms = queryTerms(question);
  const words = [...new Set(question.toLowerCase().split(/[^\p{L}\p{N}#+]+/u))].filter((w) => w.length >= 3 && terms.some((t) => t === w.normalize("NFD").replace(/[̀-ͯ]/g, ""))).slice(0, 6);
  const lexical = words.length
    ? await db.documentChunk.findMany({
        where: { userId, versionId: { in: versionIds }, OR: words.map((w) => ({ content: { contains: w, mode: "insensitive" as const } })) },
        select: { id: true, content: true },
        take: 400,
      })
    : [];
  const lexRank = lexical
    .map((c) => ({ id: c.id, s: lexicalScore(c.content, terms) }))
    .filter((c) => c.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 40)
    .map((c) => c.id);

  // 2. Sémantique : seulement sur les passages déjà vectorisés
  let semRank: string[] = [];
  const provider = getProvider();
  if (provider?.embed && provider.embeddingModel) {
    const embedded = await db.documentChunk.findMany({
      where: { userId, versionId: { in: versionIds }, embeddingModel: provider.embeddingModel },
      select: { id: true, embedding: true },
      take: 8000,
    });
    if (embedded.length) {
      try {
        const [q] = await provider.embed([question], "query", signal ?? AbortSignal.timeout(30_000));
        semRank = embedded
          .map((c) => ({ id: c.id, s: dot(q, c.embedding) }))
          .sort((a, b) => b.s - a.s)
          .slice(0, 40)
          .map((c) => c.id);
      } catch (e) {
        console.warn("[chat] recherche sémantique indisponible :", e instanceof Error ? e.message : "erreur");
      }
    }
  }

  const fused = [...fuseRankings([lexRank, semRank].filter((r) => r.length)).entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (!fused.length) return [];
  const rows = await db.documentChunk.findMany({
    where: { id: { in: fused.map(([id]) => id) }, userId },
    select: { id: true, versionId: true, page: true, content: true },
  });
  const sectionCache = new Map<string, Section[]>();
  const hits: Hit[] = [];
  for (const [id] of fused) {
    const row = rows.find((r) => r.id === id);
    const doc = row && byVersion.get(row.versionId);
    if (!row || !doc) continue;
    if (!sectionCache.has(row.versionId)) sectionCache.set(row.versionId, await sectionsFor(userId, row.versionId));
    hits.push({ chunkId: row.id, documentId: doc.id, documentName: doc.name, subjectId: doc.subjectId, versionId: doc.versionId, page: row.page, section: sectionLabel(sectionCache.get(row.versionId)!, row.page), content: row.content });
  }
  return hits;
}

const PART_CHARS = 3500;
const MAX_PARTS_PER_READ = 4;

/**
 * Lecture progressive : pages d'un PDF, ou « parties » de ~3 500 caractères pour les documents sans pagination.
 * Renvoie le total pour que l'IA sache où elle en est dans le document.
 */
export async function readPart(userId: string, documentId: string, from: number, to?: number) {
  const [doc] = await resolveDocs(userId, { documentIds: [documentId] });
  if (!doc) throw new ApiHttpError("Document introuvable ou pas encore extrait.", 404);
  const chunks = await db.documentChunk.findMany({
    where: { userId, versionId: doc.versionId },
    orderBy: { idx: "asc" },
    select: { idx: true, page: true, charStart: true, charEnd: true, content: true },
  });
  const pages = stitchChunks(chunks);
  const paged = pages.some((p) => p.page != null);
  const units = paged
    ? pages.filter((p) => p.page != null).map((p) => ({ n: p.page as number, text: p.text }))
    : (() => {
        const all = pages.map((p) => p.text).join("\n\n");
        return Array.from({ length: Math.ceil(all.length / PART_CHARS) }, (_, i) => ({ n: i + 1, text: all.slice(i * PART_CHARS, (i + 1) * PART_CHARS) }));
      })();
  const total = paged ? (doc.pageCount ?? Math.max(0, ...units.map((u) => u.n))) : units.length;
  const start = Math.max(1, Math.floor(from));
  const end = Math.min(Math.max(start, Math.floor(to ?? start)), start + MAX_PARTS_PER_READ - 1);
  const selected = units.filter((u) => u.n >= start && u.n <= end);
  const sections = await sectionsFor(userId, doc.versionId);
  return {
    doc,
    unit: paged ? ("page" as const) : ("partie" as const),
    total,
    parts: selected.map((u) => ({ n: u.n, text: u.text.slice(0, 6000), section: paged ? sectionLabel(sections, u.n) : null })),
    /** Unités demandées mais sans texte extrait : l'IA doit le dire plutôt que combler. */
    missing: Array.from({ length: end - start + 1 }, (_, i) => start + i).filter((n) => n <= total && !selected.some((u) => u.n === n)),
  };
}

/** Couverture réelle d'un document, calculée à partir des passages indexés. */
export async function documentCoverage(userId: string, doc: DocInfo): Promise<Coverage> {
  const chunks = await db.documentChunk.findMany({ where: { userId, versionId: doc.versionId }, select: { page: true, embeddingModel: true } });
  const model = getProvider()?.embeddingModel;
  return computeCoverage({
    pageCount: doc.pageCount,
    pages: chunks.map((c) => c.page),
    embeddedPassages: model ? chunks.filter((c) => c.embeddingModel === model).length : 0,
    extractWarnings: doc.extractWarnings.filter((w) => !/^Page \d+ illisible/.test(w) && !/^Unrecognised .* style/i.test(w)),
    extractStatus: doc.extractStatus,
  });
}
