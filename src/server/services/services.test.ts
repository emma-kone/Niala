// Tests d'intégration des services dossiers/documents : vrai Prisma sur un Postgres PGlite
// (migrations réelles appliquées) et stockage local dans un dossier temporaire.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

type Services = {
  folders: typeof import("./folders");
  docs: typeof import("./documents");
  db: typeof import("@/lib/db").db;
};
let s: Services;
let server: PGLiteSocketServer;
let pg: PGlite;
let storageDir: string;
let A: string; // userId A
let B: string; // userId B
let subjA: string;
let subjB: string;

const migrations = path.join(process.cwd(), "prisma", "migrations");

beforeAll(async () => {
  pg = await PGlite.create();
  for (const name of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261113000000_niala_google_link", "20261116000000_niala_profile_exercises", "20261117000000_niala_class_level_other", "20261118000000_niala_admin", "20261119000000_niala_langues_edt_reset", "20261120000000_niala_agenda_sections", "20261121000000_niala_soft_delete", "20261122000000_niala_assistance_push", "20261123000000_niala_rate_limit"]) {
    await pg.exec(readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  }
  const port = 20000 + Math.floor(Math.random() * 10000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  storageDir = mkdtempSync(path.join(tmpdir(), "sf-storage-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = storageDir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const { db } = await import("@/lib/db");
  s = { db, folders: await import("./folders"), docs: await import("./documents") };
  const ua = await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } });
  const ub = await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } });
  A = ua.id;
  B = ub.id;
  subjA = (await db.subject.create({ data: { userId: A, name: "Algo" } })).id;
  subjB = (await db.subject.create({ data: { userId: B, name: "Réseaux" } })).id;
}, 60_000);

afterAll(async () => {
  await s?.db.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(storageDir, { recursive: true, force: true });
});

const fileCount = () => {
  const walk = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(path.join(d, e.name)) : 1), 0);
  return walk(storageDir);
};

async function importFile(user: string, subject: string, folderId: string | null, name: string, content: string | Buffer) {
  const data = Buffer.from(content);
  const [r] = await s.docs.prepareUploads(user, { subjectId: subject, folderId, files: [{ name, size: data.length }] });
  if (!r.ok) return { prepared: r } as const;
  await s.docs.receiveLocalUpload(user, r.versionId, data);
  const fin = await s.docs.finalizeUpload(user, r.versionId);
  return { prepared: r, fin } as const;
}

describe("dossiers", () => {
  let root: string, child: string, other: string;

  it("crée une hiérarchie libre et refuse les doublons (racine comprise)", async () => {
    root = (await s.folders.createFolder(A, { subjectId: subjA, parentId: null, name: "  Semestre 1 " })).id;
    child = (await s.folders.createFolder(A, { subjectId: subjA, parentId: root, name: "TD" })).id;
    other = (await s.folders.createFolder(A, { subjectId: subjA, parentId: null, name: "Divers" })).id;
    await expect(s.folders.createFolder(A, { subjectId: subjA, parentId: null, name: "semestre 1" })).rejects.toMatchObject({ status: 409 });
    await expect(s.folders.createFolder(A, { subjectId: subjA, parentId: root, name: "a/b" })).rejects.toMatchObject({ status: 422 });
  });

  it("renomme, déplace et refuse les cycles", async () => {
    await s.folders.renameFolder(A, child, "TP");
    await expect(s.folders.moveItems(A, { subjectId: subjA, folderIds: [root], documentIds: [], targetFolderId: child })).rejects.toMatchObject({ status: 422 });
    await s.folders.moveItems(A, { subjectId: subjA, folderIds: [child], documentIds: [], targetFolderId: other });
    const f = await s.db.folder.findUniqueOrThrow({ where: { id: child } });
    expect(f.parentId).toBe(other);
    expect(f.name).toBe("TP");
  });

  it("isole les utilisateurs", async () => {
    await expect(s.folders.renameFolder(B, root, "Piraté")).rejects.toMatchObject({ status: 404 });
    await expect(s.folders.deleteFolder(B, root)).rejects.toMatchObject({ status: 404 });
    await expect(s.folders.createFolder(B, { subjectId: subjA, parentId: null, name: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(s.folders.createFolder(B, { subjectId: subjB, parentId: root, name: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.explorer(B, { subjectId: subjA, folderId: null })).rejects.toMatchObject({ status: 404 });
  });
});

describe("import et documents", () => {
  let folder: string;
  let docId: string;

  it("importe un texte : original conservé, extraction indexée avec pages", async () => {
    folder = (await s.folders.createFolder(A, { subjectId: subjA, parentId: null, name: "Cours" })).id;
    const text = "Les fonctions permettent de réutiliser du code. ".repeat(40);
    const { fin } = await importFile(A, subjA, folder, "fonctions.txt", text);
    expect(fin).toMatchObject({ ok: true, status: "READY" });
    docId = fin!.documentId;
    expect(fileCount()).toBe(2); // original + aperçu PDF
    expect(await s.docs.ensurePdfPreview(A, docId)).toMatchObject({ available: true, source: "converted" });
    await expect(s.docs.ensurePdfPreview(B, docId)).rejects.toThrow();
    const chunks = await s.db.documentChunk.count({ where: { userId: A } });
    expect(chunks).toBeGreaterThan(0);
    // l'original est restitué tel quel
    const { key } = await s.docs.openOriginal(A, docId);
    const { getStorage } = await import("@/server/storage");
    expect((await getStorage().read(key)).toString()).toBe(text);
    // compatibilité V1 : le document est visible par la génération actuelle
    // la double écriture V1 (extractedText, LegacyDocumentChunk) a été retirée en phase 9
    const doc = await s.db.document.findUniqueOrThrow({ where: { id: docId } });
    expect(doc.status).toBe("READY");
    expect(doc.extractedText).toBeNull();
  });

  it("refuse un format inconnu, un fichier vide et une signature falsifiée", async () => {
    const bad = await s.docs.prepareUploads(A, { subjectId: subjA, folderId: null, files: [{ name: "x.exe", size: 10 }, { name: "vide.txt", size: 0 }] });
    expect(bad.every((r) => !r.ok)).toBe(true);
    const before = fileCount();
    const { fin } = await importFile(A, subjA, null, "faux.pdf", "ceci n'est pas un pdf");
    expect(fin).toMatchObject({ ok: false });
    expect(fileCount()).toBe(before); // fichier rejeté supprimé
    expect(await s.db.document.count({ where: { originalName: "faux.pdf" } })).toBe(0);
  });

  it("refuse un fichier plus gros que la taille annoncée", async () => {
    const [r] = await s.docs.prepareUploads(A, { subjectId: subjA, folderId: null, files: [{ name: "petit.txt", size: 5 }] });
    if (!r.ok) throw new Error("préparation attendue");
    await expect(s.docs.receiveLocalUpload(A, r.versionId, Buffer.from("beaucoup trop long"))).rejects.toMatchObject({ status: 413 });
    await s.docs.deleteDocuments(A, [r.documentId]);
  });

  it("un autre utilisateur ne peut ni déposer, ni finaliser, ni lire", async () => {
    const [r] = await s.docs.prepareUploads(A, { subjectId: subjA, folderId: null, files: [{ name: "prive.txt", size: 5 }] });
    if (!r.ok) throw new Error("préparation attendue");
    await expect(s.docs.receiveLocalUpload(B, r.versionId, Buffer.from("12345"))).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.finalizeUpload(B, r.versionId)).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.openOriginal(B, docId)).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.getDocumentProperties(B, docId)).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.renameDocument(B, docId, "x")).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.deleteDocuments(B, [docId])).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.prepareUploads(B, { subjectId: subjA, folderId: null, files: [{ name: "a.txt", size: 3 }] })).rejects.toMatchObject({ status: 404 });
    await s.docs.deleteDocuments(A, [r.documentId]);
  });

  it("signale un doublon de contenu sans le bloquer", async () => {
    const text = "Les fonctions permettent de réutiliser du code. ".repeat(40);
    const { fin } = await importFile(A, subjA, null, "copie.txt", text);
    expect(fin).toMatchObject({ ok: true });
    expect(fin!.duplicateOf?.id).toBe(docId);
  });

  it("liste, trie, filtre et recherche (nom et contenu)", async () => {
    const inFolder = await s.docs.explorer(A, { subjectId: subjA, folderId: folder });
    expect(inFolder.documents.map((d) => d.originalName)).toEqual(["fonctions.txt"]);
    expect(inFolder.path.map((p) => p.name)).toEqual(["Cours"]);
    const root = await s.docs.explorer(A, { subjectId: subjA, folderId: null });
    expect(root.documents.map((d) => d.originalName)).toEqual(["copie.txt"]);

    const byName = await s.docs.explorer(A, { subjectId: subjA, folderId: null, q: "FONCTIONS" });
    expect(byName.searching).toBe(true);
    expect(byName.documents.map((d) => d.originalName)).toEqual(["fonctions.txt"]);
    expect(byName.documents[0].folderPath).toBe("Cours");

    await importFile(A, subjA, null, "notes.md", "# Pointeurs\nUn pointeur contient une adresse mémoire, ce qui est essentiel.");
    expect((await s.docs.explorer(A, { subjectId: subjA, folderId: null, q: "adresse" })).documents).toHaveLength(0);
    expect((await s.docs.explorer(A, { subjectId: subjA, folderId: null, q: "adresse", inContent: true })).documents.map((d) => d.originalName)).toEqual(["notes.md"]);

    const sorted = await s.docs.explorer(A, { subjectId: subjA, folderId: null, q: ".", sort: "name", dir: "asc" });
    const names = sorted.documents.map((d) => d.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })));
    expect((await s.docs.explorer(A, { subjectId: subjA, folderId: null, q: ".", kind: "md" })).documents).toHaveLength(1);
  });

  it("renomme, déplace un document et expose ses propriétés", async () => {
    await s.docs.renameDocument(A, docId, "  Les   fonctions ");
    await s.folders.moveItems(A, { subjectId: subjA, folderIds: [], documentIds: [docId], targetFolderId: null });
    const p = await s.docs.getDocumentProperties(A, docId);
    expect(p).toMatchObject({ name: "Les fonctions", folderId: null, status: "READY", originalMissing: false });
    expect(p.sha256).toHaveLength(64);
    expect(p.indexedPassages).toBeGreaterThan(0);
    expect(p.versions).toHaveLength(1);
    // déplacement d'un document d'une autre matière : refusé
    await expect(s.folders.moveItems(A, { subjectId: subjA, folderIds: [], documentIds: ["inconnu"], targetFolderId: null })).rejects.toMatchObject({ status: 404 });
  });

  it("mémorise la page lue, crée l'activité de lecture et borne la page", async () => {
    const { fin } = await importFile(A, subjA, null, "lecture.txt", "Contenu à lire suffisamment long pour être indexé correctement.");
    const id = fin!.documentId;
    expect((await s.docs.recordReading(A, id, 7)).page).toBeGreaterThanOrEqual(1);
    await s.docs.recordReading(A, id, 1);
    await s.docs.recordReading(A, id, 1);
    expect(await s.db.learningActivity.count({ where: { userId: A, refId: id } })).toBe(1);
    const act = await s.db.learningActivity.findFirstOrThrow({ where: { userId: A, refId: id } });
    expect(act).toMatchObject({ type: "READING", status: "IN_PROGRESS" });
    expect((await s.docs.getDocumentProperties(A, id)).lastPage).toBe(1);
    await expect(s.docs.recordReading(B, id, 1)).rejects.toMatchObject({ status: 404 });
    await expect(s.docs.readingText(B, id)).rejects.toMatchObject({ status: 404 });
    const text = await s.docs.readingText(A, id);
    expect(text.pages[0].text).toContain("Contenu à lire");
    await s.docs.deleteDocuments(A, [id]);
    expect(await s.db.learningActivity.count({ where: { refId: id } })).toBe(0); // plus d'activité orpheline
  });

  it("supprime un dossier récursivement avec ses fichiers", async () => {
    const sub = (await s.folders.createFolder(A, { subjectId: subjA, parentId: folder, name: "Sous" })).id;
    await importFile(A, subjA, folder, "a.txt", "Contenu suffisamment long pour être indexé correctement ici.");
    await importFile(A, subjA, sub, "b.txt", "Un autre contenu suffisamment long pour être indexé correctement.");
    const before = fileCount();
    const res = await s.folders.deleteFolder(A, folder);
    expect(res).toMatchObject({ deletedFolders: 2, deletedDocuments: 2 });
    expect(fileCount()).toBe(before - 4);
    expect(await s.db.folder.count({ where: { id: { in: [folder, sub] } } })).toBe(0);
  });

  it("supprime les fichiers du stockage avec le document", async () => {
    const before = fileCount();
    await s.docs.deleteDocuments(A, [docId]);
    expect(fileCount()).toBe(before - 2);
    expect(await s.db.documentChunk.count({ where: { version: { documentId: docId } } })).toBe(0);
  });
});
