import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import {
  canMoveFolder,
  depthOf,
  MAX_FOLDER_DEPTH,
  nameKey,
  normalizeFolderName,
  validateFolderName,
  descendantIds,
  type FolderNode,
} from "@/server/domain/folder-tree";
import { getStorage } from "@/server/storage";

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** Matière appartenant à l'utilisateur, sinon 404 (jamais 403 : on ne révèle pas l'existence). */
export async function requireSubject(userId: string, subjectId: string) {
  const subject = await db.subject.findFirst({ where: { id: subjectId, userId } });
  if (!subject) throw new ApiHttpError("Matière introuvable.", 404);
  return subject;
}

export async function loadFolders(client: Tx | typeof db, userId: string, subjectId: string): Promise<FolderNode[]> {
  return client.folder.findMany({
    where: { userId, subjectId },
    select: { id: true, parentId: true, name: true },
  });
}

function checkName(raw: string): string {
  const name = normalizeFolderName(raw);
  const problem = validateFolderName(name);
  if (problem) throw new ApiHttpError(problem, 422);
  return name;
}

function assertNameFree(folders: FolderNode[], parentId: string | null, name: string, exceptId?: string) {
  const clash = folders.find((f) => f.id !== exceptId && f.parentId === parentId && nameKey(f.name) === nameKey(name));
  if (clash) throw new ApiHttpError(`Un dossier « ${clash.name} » existe déjà à cet emplacement.`, 409);
}

export async function createFolder(userId: string, input: { subjectId: string; parentId: string | null; name: string }) {
  const name = checkName(input.name);
  await requireSubject(userId, input.subjectId);
  return db.$transaction(async (tx) => {
    const folders = await loadFolders(tx, userId, input.subjectId);
    if (input.parentId && !folders.some((f) => f.id === input.parentId)) throw new ApiHttpError("Dossier parent introuvable.", 404);
    if (depthOf(folders, input.parentId) + 1 > MAX_FOLDER_DEPTH) {
      throw new ApiHttpError(`Profondeur maximale de ${MAX_FOLDER_DEPTH} niveaux dépassée.`, 422);
    }
    assertNameFree(folders, input.parentId, name);
    return tx.folder.create({ data: { userId, subjectId: input.subjectId, parentId: input.parentId, name } });
  });
}

async function ownedFolder(userId: string, id: string) {
  const folder = await db.folder.findFirst({ where: { id, userId } });
  if (!folder) throw new ApiHttpError("Dossier introuvable.", 404);
  return folder;
}

export async function renameFolder(userId: string, id: string, rawName: string) {
  const name = checkName(rawName);
  const folder = await ownedFolder(userId, id);
  return db.$transaction(async (tx) => {
    assertNameFree(await loadFolders(tx, userId, folder.subjectId), folder.parentId, name, id);
    return tx.folder.update({ where: { id }, data: { name } });
  });
}

/** Déplace dossiers et documents vers un dossier cible de la MÊME matière (null = racine). */
export async function moveItems(
  userId: string,
  input: { subjectId: string; folderIds: string[]; documentIds: string[]; targetFolderId: string | null }
) {
  await requireSubject(userId, input.subjectId);
  return db.$transaction(async (tx) => {
    const folders = await loadFolders(tx, userId, input.subjectId);
    if (input.targetFolderId && !folders.some((f) => f.id === input.targetFolderId)) {
      throw new ApiHttpError("Dossier de destination introuvable.", 404);
    }
    const knownFolders = new Set(folders.map((f) => f.id));
    let working = folders;
    for (const id of input.folderIds) {
      if (!knownFolders.has(id)) throw new ApiHttpError("Dossier introuvable.", 404);
      const check = canMoveFolder(working, id, input.targetFolderId);
      if (!check.ok) throw new ApiHttpError(check.reason, 422);
      const node = working.find((f) => f.id === id)!;
      assertNameFree(working, input.targetFolderId, node.name, id);
      await tx.folder.update({ where: { id }, data: { parentId: input.targetFolderId } });
      working = working.map((f) => (f.id === id ? { ...f, parentId: input.targetFolderId } : f));
    }
    if (input.documentIds.length) {
      const docs = await tx.document.findMany({
        where: { id: { in: input.documentIds }, userId, subjectId: input.subjectId },
        select: { id: true },
      });
      if (docs.length !== new Set(input.documentIds).size) throw new ApiHttpError("Document introuvable.", 404);
      await tx.document.updateMany({
        where: { id: { in: docs.map((d) => d.id) }, userId },
        data: { folderId: input.targetFolderId },
      });
    }
    return { moved: input.folderIds.length + input.documentIds.length };
  });
}

/** Supprime un dossier, ses sous-dossiers et tous les documents qu'ils contiennent (fichiers compris). */
export async function deleteFolder(userId: string, id: string) {
  const folder = await ownedFolder(userId, id);
  const { keys, documents, folderCount } = await db.$transaction(async (tx) => {
    const folders = await loadFolders(tx, userId, folder.subjectId);
    const ids = [id, ...descendantIds(folders, id)];
    const docs = await tx.document.findMany({
      where: { userId, folderId: { in: ids } },
      select: { id: true, versions: { select: { storageKey: true } } },
    });
    await tx.learningActivity.deleteMany({ where: { userId, refType: "document", refId: { in: docs.map((d) => d.id) } } });
    await tx.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) }, userId } });
    // Plus profond d'abord : la relation parent est en Restrict
    const order = [...ids].reverse();
    for (const fid of order) await tx.folder.delete({ where: { id: fid } });
    return {
      keys: docs.flatMap((d) => d.versions.map((v) => v.storageKey).filter((k): k is string => !!k)),
      documents: docs.length,
      folderCount: ids.length,
    };
  });
  // Après validation de la transaction : un échec de stockage ne laisse pas de ligne orpheline en base.
  await getStorage().remove(keys).catch((e) => console.error("[storage] suppression partielle", e));
  return { deletedFolders: folderCount, deletedDocuments: documents };
}
