import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { chunkText, extractContent } from "@/lib/extraction";
import { getStorage, newStorageKey, previewKey, withPreviewKeys } from "@/server/storage";
import { canConvertToPdf, convertToPdf } from "@/server/pdf/convert";
import { chunkPages, splitPages, stitchChunks, type PageText } from "@/server/domain/chunking";
import {
  detectKind,
  matchesSignature,
  mimeFor,
  sanitizeName,
  MAX_FILES_PER_IMPORT,
  MAX_UPLOAD_MB_CEILING,
} from "@/server/domain/file-validation";
import { pathTo } from "@/server/domain/folder-tree";
import { loadFolders, requireSubject } from "@/server/services/folders";

// ─────────────────────────────────────────────────────────────────────────────
// Documents V2 : l'ORIGINAL est stocké tel quel (DocumentVersion.storageKey) ; le texte
// extrait n'est qu'un index (DocumentChunk). Flux d'import en trois temps :
//   prepare → (le client envoie le fichier au stockage) → finalize (contrôle + extraction).
// ─────────────────────────────────────────────────────────────────────────────

export async function maxUploadBytes(userId: string): Promise<number> {
  const settings = await db.userSettings.findUnique({ where: { userId } });
  const mb = Math.min(MAX_UPLOAD_MB_CEILING, Math.max(1, settings?.maxUploadMB ?? 20));
  return mb * 1024 * 1024;
}

export interface PrepareInput {
  subjectId: string | null;
  folderId: string | null;
  files: { name: string; size: number }[];
}

export type PrepareResult =
  | { name: string; ok: true; documentId: string; versionId: string; upload: { url: string; method: "PUT"; headers: Record<string, string> } }
  | { name: string; ok: false; error: string };

export async function prepareUploads(userId: string, input: PrepareInput): Promise<PrepareResult[]> {
  if (input.files.length === 0) throw new ApiHttpError("Aucun fichier reçu.", 400);
  if (input.files.length > MAX_FILES_PER_IMPORT) throw new ApiHttpError(`Maximum ${MAX_FILES_PER_IMPORT} fichiers par import.`, 400);
  if (input.subjectId) await requireSubject(userId, input.subjectId);
  else if (input.folderId) throw new ApiHttpError("Dossier introuvable.", 404);
  if (input.subjectId && input.folderId) {
    const folders = await loadFolders(db, userId, input.subjectId);
    if (!folders.some((f) => f.id === input.folderId)) throw new ApiHttpError("Dossier introuvable.", 404);
  }
  const limit = await maxUploadBytes(userId);
  const storage = getStorage();
  const results: PrepareResult[] = [];

  for (const file of input.files) {
    const name = sanitizeName(file.name);
    const kind = detectKind(name);
    if (!kind) {
      results.push({ name: file.name, ok: false, error: "Format non pris en charge. Formats acceptés : PDF, DOCX, PPTX, TXT, MD." });
      continue;
    }
    if (!Number.isInteger(file.size) || file.size <= 0) {
      results.push({ name, ok: false, error: "Fichier vide." });
      continue;
    }
    if (file.size > limit) {
      results.push({ name, ok: false, error: `Fichier trop volumineux (${(file.size / 1048576).toFixed(1)} Mo, maximum ${Math.round(limit / 1048576)} Mo).` });
      continue;
    }
    try {
      const mime = mimeFor(kind);
      const doc = await db.document.create({
        data: {
          userId,
          subjectId: input.subjectId,
          folderId: input.folderId,
          name: name.replace(/\.[^.]+$/, "") || name,
          originalName: name,
          type: kind,
          size: file.size,
          status: "PENDING",
        },
      });
      const key = newStorageKey(userId, doc.id, 1, randomBytes(12).toString("hex"));
      const version = await db.documentVersion.create({
        data: { userId, documentId: doc.id, number: 1, storageKey: key, mime, size: file.size, extractStatus: "PENDING" },
      });
      await db.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
      const upload = await storage.createUploadTarget(key, mime, `/api/uploads/${version.id}/content`);
      results.push({ name, ok: true, documentId: doc.id, versionId: version.id, upload });
    } catch (e) {
      console.error("[prepareUploads]", e);
      results.push({ name, ok: false, error: "Impossible de préparer l'import de ce fichier." });
    }
  }
  return results;
}

async function ownedPendingVersion(userId: string, versionId: string) {
  const version = await db.documentVersion.findFirst({
    where: { id: versionId, userId },
    include: { document: true },
  });
  if (!version) throw new ApiHttpError("Import introuvable.", 404);
  return version;
}

/** Réception du fichier quand le driver n'offre pas d'URL directe (stockage local). */
export async function receiveLocalUpload(userId: string, versionId: string, data: Buffer) {
  const version = await ownedPendingVersion(userId, versionId);
  if (version.extractStatus !== "PENDING" || !version.storageKey) throw new ApiHttpError("Import déjà traité.", 409);
  const limit = await maxUploadBytes(userId);
  if (data.length === 0) throw new ApiHttpError("Fichier vide.", 400);
  if (data.length > limit || data.length > version.size) throw new ApiHttpError("Le fichier dépasse la taille annoncée.", 413);
  await getStorage().put(version.storageKey, data, version.mime);
  return { ok: true };
}

async function discard(versionId: string, documentId: string, key: string | null) {
  await db.document.delete({ where: { id: documentId } }).catch(() => undefined);
  if (key) await getStorage().remove([key]).catch(() => undefined);
  void versionId;
}

export interface FinalizeResult {
  ok: boolean;
  documentId: string;
  status: string;
  warnings: string[];
  duplicateOf?: { id: string; name: string };
  error?: string;
}

export async function finalizeUpload(userId: string, versionId: string): Promise<FinalizeResult> {
  const version = await ownedPendingVersion(userId, versionId);
  const doc = version.document;
  const key = version.storageKey;
  if (version.extractStatus !== "PENDING") {
    return { ok: version.extractStatus !== "FAILED", documentId: doc.id, status: version.extractStatus, warnings: [] };
  }
  const kind = detectKind(doc.originalName);
  const storage = getStorage();
  if (!key || !kind) {
    await discard(versionId, doc.id, key);
    return { ok: false, documentId: doc.id, status: "FAILED", warnings: [], error: "Import invalide." };
  }

  // 1. Le fichier est-il bien arrivé, à la bonne taille, avec le bon contenu ?
  const limit = await maxUploadBytes(userId);
  const stored = await storage.size(key);
  if (stored == null || stored === 0) {
    await discard(versionId, doc.id, key);
    return { ok: false, documentId: doc.id, status: "FAILED", warnings: [], error: "Le fichier n'a pas été reçu. Réessayez l'import." };
  }
  if (stored > limit) {
    await discard(versionId, doc.id, key);
    return { ok: false, documentId: doc.id, status: "FAILED", warnings: [], error: "Fichier trop volumineux." };
  }
  const buffer = await storage.read(key);
  if (!matchesSignature(kind, buffer.subarray(0, 4096))) {
    await discard(versionId, doc.id, key);
    return { ok: false, documentId: doc.id, status: "FAILED", warnings: [], error: `Le contenu ne correspond pas à un fichier ${kind.toUpperCase()} valide.` };
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const dupe = await db.documentVersion.findFirst({
    where: { userId, sha256, documentId: { not: doc.id }, document: { subjectId: doc.subjectId } },
    select: { document: { select: { id: true, name: true } } },
  });

  await db.documentVersion.update({ where: { id: versionId }, data: { extractStatus: "PROCESSING", size: buffer.length, sha256 } });

  // 2. Extraction + indexation (l'original reste intact quoi qu'il arrive)
  try {
    const extracted = await extractContent(kind, buffer);
    const text = extracted.text?.trim() ?? "";
    const warnings = [...extracted.meta.warnings];
    const hasText = text.replace(/\s/g, "").length >= 20;
    if (!hasText) warnings.unshift("Aucun texte extractible (document scanné ou composé d'images). Le fichier reste consultable, mais l'analyse IA n'est pas possible.");
    const passages = hasText ? chunkPages(splitPages(text)) : [];
    const status = !hasText ? "UNSUPPORTED" : warnings.length ? "PARTIAL" : "READY";

    await db.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({ where: { versionId } });
      if (passages.length) {
        await tx.documentChunk.createMany({
          data: passages.map((p, idx) => ({
            userId,
            versionId,
            idx,
            page: p.page,
            charStart: p.charStart,
            charEnd: p.charEnd,
            content: p.content,
            words: p.content.split(/\s+/).length,
          })),
        });
      }
      await tx.documentVersion.update({
        where: { id: versionId },
        data: { extractStatus: status, pageCount: extracted.pageCount ?? null, extractWarnings: warnings },
      });
      // Champs d'état du document (l'extraction complète vit dans DocumentVersion / DocumentChunk).
      await tx.document.update({
        where: { id: doc.id },
        data: {
          status: hasText ? "READY" : "ERROR",
          error: hasText ? null : warnings[0],
          pageCount: extracted.pageCount ?? null,
          meta: JSON.stringify(extracted.meta),
        },
      });
    });
    // Aperçu PDF (meilleur effort : un échec n'invalide pas l'import, il sera retenté à l'ouverture)
    await ensurePdfPreview(userId, doc.id).catch((e) => console.error("[finalizeUpload] aperçu PDF", e));
    return {
      ok: true,
      documentId: doc.id,
      status,
      warnings,
      duplicateOf: dupe ? { id: dupe.document.id, name: dupe.document.name } : undefined,
    };
  } catch (e) {
    console.error("[finalizeUpload] extraction", e);
    const message = "Extraction du texte impossible. Le fichier original est conservé.";
    await db.documentVersion.update({ where: { id: versionId }, data: { extractStatus: "FAILED", extractError: message } });
    await db.document.update({ where: { id: doc.id }, data: { status: "ERROR", error: message } });
    return { ok: false, documentId: doc.id, status: "FAILED", warnings: [], error: message };
  }
}

// ── Lecture / propriétés / mutations ─────────────────────────────────────────

export interface DocumentDto {
  id: string;
  name: string;
  originalName: string;
  kind: string;
  mime: string;
  size: number;
  pageCount: number | null;
  status: string;
  warnings: string[];
  originalMissing: boolean;
  folderId: string | null;
  folderPath: string;
  versionNumber: number;
  createdAt: Date;
  updatedAt: Date;
  lastOpenedAt: Date | null;
}

type DocWithVersion = Awaited<ReturnType<typeof fetchDocs>>[number];

function fetchDocs(userId: string, where: object, take = 500) {
  return db.document.findMany({
    where: { userId, ...where },
    include: { currentVersion: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}

function toDto(d: DocWithVersion, folderPath: (id: string | null) => string): DocumentDto {
  const v = d.currentVersion;
  return {
    id: d.id,
    name: d.name,
    originalName: d.originalName,
    kind: d.type,
    mime: v?.mime ?? "",
    size: v?.size ?? d.size,
    pageCount: v?.pageCount ?? d.pageCount,
    status: v?.extractStatus ?? "PENDING",
    warnings: Array.isArray(v?.extractWarnings) ? (v!.extractWarnings as string[]) : [],
    originalMissing: v?.originalMissing ?? false,
    folderId: d.folderId,
    folderPath: folderPath(d.folderId),
    versionNumber: v?.number ?? 1,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    lastOpenedAt: d.lastOpenedAt,
  };
}

export type ExplorerSort = "name" | "date" | "size" | "type";

export interface ExplorerQuery {
  subjectId: string;
  folderId: string | null;
  q?: string;
  inContent?: boolean;
  kind?: string;
  status?: string;
  sort?: ExplorerSort;
  dir?: "asc" | "desc";
}

export async function explorer(userId: string, query: ExplorerQuery) {
  const subject = await requireSubject(userId, query.subjectId);
  const folders = await db.folder.findMany({
    where: { userId, subjectId: subject.id },
    select: { id: true, parentId: true, name: true, updatedAt: true },
  });
  if (query.folderId && !folders.some((f) => f.id === query.folderId)) throw new ApiHttpError("Dossier introuvable.", 404);

  const nodes = folders.map(({ id, parentId, name }) => ({ id, parentId, name }));
  const pathLabel = (id: string | null) =>
    id ? pathTo(nodes, id).map((f) => f.name).join(" / ") : "";

  const q = query.q?.trim();
  const docWhere: Record<string, unknown> = { subjectId: subject.id };
  if (query.kind) docWhere.type = query.kind;
  if (query.status) docWhere.currentVersion = { extractStatus: query.status };

  if (q) {
    // Recherche dans toute la matière (noms, et contenu indexé si demandé)
    docWhere.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { originalName: { contains: q, mode: "insensitive" } },
      ...(query.inContent
        ? [{ currentVersion: { chunks: { some: { content: { contains: q, mode: "insensitive" } } } } }]
        : []),
    ];
  } else {
    docWhere.folderId = query.folderId;
  }
  const docs = await fetchDocs(userId, docWhere);
  let items = docs.map((d) => toDto(d, pathLabel));

  const dir = query.dir === "asc" ? 1 : -1;
  const cmp: Record<ExplorerSort, (a: DocumentDto, b: DocumentDto) => number> = {
    name: (a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true }),
    date: (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
    size: (a, b) => a.size - b.size,
    type: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "fr"),
  };
  items = items.sort((a, b) => cmp[query.sort ?? "date"](a, b) * dir);

  const [docCounts] = await Promise.all([
    db.document.groupBy({ by: ["folderId"], where: { userId, subjectId: subject.id }, _count: { _all: true } }),
  ]);
  const directDocs = new Map(docCounts.map((c) => [c.folderId, c._count._all]));
  const childCount = new Map<string | null, number>();
  for (const f of folders) childCount.set(f.parentId, (childCount.get(f.parentId) ?? 0) + 1);

  const visibleFolders = (q
    ? folders.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()))
    : folders.filter((f) => f.parentId === query.folderId)
  )
    .map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      path: pathLabel(f.parentId),
      documentCount: directDocs.get(f.id) ?? 0,
      folderCount: childCount.get(f.id) ?? 0,
      updatedAt: f.updatedAt,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true }));

  return {
    subject: { id: subject.id, name: subject.name, color: subject.color, icon: subject.icon },
    folderId: query.folderId,
    path: pathTo(nodes, query.folderId).map((f) => ({ id: f.id, name: f.name })),
    folders: visibleFolders,
    documents: items,
    searching: !!q,
    tree: nodes,
    totals: { documents: docCounts.reduce((a, c) => a + c._count._all, 0), folders: folders.length },
  };
}

export async function getDocumentProperties(userId: string, id: string) {
  const doc = await db.document.findFirst({
    where: { id, userId },
    include: { versions: { orderBy: { number: "desc" } }, currentVersion: true },
  });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const folders = doc.subjectId ? await loadFolders(db, userId, doc.subjectId) : [];
  const path = pathTo(folders, doc.folderId).map((f) => f.name).join(" / ");
  const [chunkCount] = await Promise.all([
    doc.currentVersionId ? db.documentChunk.count({ where: { versionId: doc.currentVersionId, userId } }) : 0,
  ]);
  return {
    ...toDto({ ...doc, currentVersion: doc.currentVersion }, () => path),
    subjectId: doc.subjectId,
    lastPage: doc.lastPage,
    sha256: doc.currentVersion?.sha256 ?? null,
    extractError: doc.currentVersion?.extractError ?? null,
    indexedPassages: chunkCount,
    versions: doc.versions.map((v) => ({
      id: v.id,
      number: v.number,
      size: v.size,
      createdAt: v.createdAt,
      status: v.extractStatus,
      originalMissing: v.originalMissing,
    })),
  };
}

export async function renameDocument(userId: string, id: string, rawName: string) {
  const name = sanitizeName(rawName).trim();
  if (!name) throw new ApiHttpError("Le nom est requis.", 422);
  const res = await db.document.updateMany({ where: { id, userId }, data: { name } });
  if (res.count === 0) throw new ApiHttpError("Document introuvable.", 404);
  return { ok: true, name };
}

export async function deleteDocuments(userId: string, ids: string[]) {
  const docs = await db.document.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, versions: { select: { storageKey: true } } },
  });
  if (docs.length !== new Set(ids).size) throw new ApiHttpError("Document introuvable.", 404);
  await db.$transaction([
    db.learningActivity.deleteMany({ where: { userId, refType: "document", refId: { in: docs.map((d) => d.id) } } }),
    db.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) }, userId } }),
  ]);
  const keys = docs.flatMap((d) => d.versions.map((v) => v.storageKey).filter((k): k is string => !!k));
  await getStorage().remove(withPreviewKeys(keys)).catch((e) => console.error("[storage] suppression partielle", e));
  return { deleted: docs.length };
}

/** Accès au fichier original d'un document de l'utilisateur. */
export async function openOriginal(userId: string, id: string, versionNumber?: number) {
  const doc = await db.document.findFirst({ where: { id, userId }, include: { currentVersion: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const version = versionNumber
    ? await db.documentVersion.findFirst({ where: { documentId: id, userId, number: versionNumber } })
    : doc.currentVersion;
  if (!version) throw new ApiHttpError("Version introuvable.", 404);
  if (!version.storageKey || version.originalMissing) {
    throw new ApiHttpError("Le fichier original de ce document n'a pas été conservé. Réimportez-le pour l'ouvrir.", 410);
  }
  return { doc, version, key: version.storageKey };
}

// ── Lecture : texte de repli et reprise ──────────────────────────────────────

/** Texte extrait page par page (repli d'affichage ; l'original reste la référence). */
export async function readingText(userId: string, id: string) {
  const doc = await db.document.findFirst({ where: { id, userId }, select: { id: true, currentVersionId: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  if (!doc.currentVersionId) return { pages: [] as PageText[] };
  const chunks = await db.documentChunk.findMany({
    where: { versionId: doc.currentVersionId, userId },
    orderBy: { idx: "asc" },
    select: { idx: true, page: true, charStart: true, charEnd: true, content: true },
  });
  return { pages: stitchChunks(chunks) };
}

/** Derniers documents ouverts : base des suggestions et du choix de contexte de la discussion. */
export async function listRecentDocuments(userId: string, take = 6) {
  const docs = await db.document.findMany({ where: { userId, lastOpenedAt: { not: null }, subjectId: { not: null } }, orderBy: [{ lastOpenedAt: "desc" }, { id: "asc" }], take, select: { id: true, name: true, subjectId: true, subject: { select: { name: true, color: true, icon: true } } } });
  return docs.map((d) => ({ id: d.id, name: d.name, subjectId: d.subjectId!, subjectName: d.subject?.name ?? "", subjectColor: d.subject?.color ?? "#8b5cf6", subjectIcon: d.subject?.icon ?? null }));
}

/** Une ouverture réelle du document dans le lecteur : il remonte en tête des derniers cours consultés. */
export async function recordOpening(userId: string, id: string) {
  const res = await db.document.updateMany({ where: { id, userId }, data: { lastOpenedAt: new Date() } });
  if (res.count === 0) throw new ApiHttpError("Document introuvable.", 404);
  return { ok: true };
}

/** Mémorise la page lue et crée/met à jour l'activité « lecture » (reprise depuis le tableau de bord). */
export async function recordReading(userId: string, id: string, page: number) {
  const doc = await db.document.findFirst({ where: { id, userId }, select: { id: true, name: true, subjectId: true, pageCount: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const max = doc.pageCount ?? Number.MAX_SAFE_INTEGER;
  const safePage = Math.min(Math.max(1, Math.floor(page)), max);
  await db.$transaction(async (tx) => {
    await tx.document.update({ where: { id }, data: { lastPage: safePage, lastOpenedAt: new Date() } });
    const existing = await tx.learningActivity.findFirst({ where: { userId, type: "READING", refType: "document", refId: id } });
    const data = { title: doc.name, subjectId: doc.subjectId, status: "IN_PROGRESS" as const, lastPosition: { page: safePage } };
    if (existing) await tx.learningActivity.update({ where: { id: existing.id }, data });
    else await tx.learningActivity.create({ data: { userId, type: "READING", refType: "document", refId: id, ...data } });
  });
  return { page: safePage };
}

// ── Aperçu PDF (lecture seule) ───────────────────────────────────────────────

export interface PdfPreview {
  available: boolean;
  /** "original" : le fichier est déjà un PDF ; "converted" : PDF généré à partir du fichier importé. */
  source?: "original" | "converted";
  key?: string;
  reason?: string;
}

/** Garantit qu'un PDF consultable existe pour la version courante (le génère au besoin, une seule fois). */
export async function ensurePdfPreview(userId: string, id: string): Promise<PdfPreview> {
  const doc = await db.document.findFirst({ where: { id, userId }, include: { currentVersion: true } });
  if (!doc) throw new ApiHttpError("Document introuvable.", 404);
  const version = doc.currentVersion;
  if (!version?.storageKey || version.originalMissing) return { available: false, reason: "Original non conservé." };
  if (doc.type === "pdf") return { available: true, source: "original", key: version.storageKey };
  if (!canConvertToPdf(doc.type)) return { available: false, reason: `Format ${doc.type.toUpperCase()} non convertible.` };

  const storage = getStorage();
  const key = previewKey(version.storageKey);
  if (((await storage.size(key)) ?? 0) > 0) return { available: true, source: "converted", key };
  try {
    const result = await convertToPdf(doc.type, await storage.read(version.storageKey));
    await storage.put(key, result.pdf, "application/pdf");
    if (version.pageCount == null) {
      await db.documentVersion.update({ where: { id: version.id }, data: { pageCount: result.pageCount } });
      await db.document.update({ where: { id }, data: { pageCount: result.pageCount } });
    }
    return { available: true, source: "converted", key };
  } catch (e) {
    console.error("[ensurePdfPreview]", e);
    return { available: false, reason: "La conversion en PDF a échoué." };
  }
}
