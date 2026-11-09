// Tests d'intégration du système de notes unifié (Prisma + PGlite).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

type Db = typeof import("@/lib/db").db;
let db: Db;
let notes: typeof import("./notes");
let docsSvc: typeof import("./documents");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string, subjA: string, subjA2: string, subjB: string, doc1: string, doc2: string, docOther: string;

beforeAll(async () => {
  pg = await PGlite.create();
  for (const n of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon"]) {
    await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "migrations", n, "migration.sql"), "utf8"));
  }
  const port = 30000 + Math.floor(Math.random() * 10000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "sf-notes-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  db = (await import("@/lib/db")).db;
  notes = await import("./notes");
  docsSvc = await import("./documents");

  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
  subjA = (await db.subject.create({ data: { userId: A, name: "Algo" } })).id;
  subjA2 = (await db.subject.create({ data: { userId: A, name: "Réseaux" } })).id;
  subjB = (await db.subject.create({ data: { userId: B, name: "BD" } })).id;
  const mk = async (user: string, subject: string, name: string) => {
    const data = Buffer.from("Un contenu de cours suffisamment long pour être indexé correctement ici.");
    const [r] = await docsSvc.prepareUploads(user, { subjectId: subject, folderId: null, files: [{ name, size: data.length }] });
    if (!r.ok) throw new Error("prepare");
    await docsSvc.receiveLocalUpload(user, r.versionId, data);
    await docsSvc.finalizeUpload(user, r.versionId);
    return r.documentId;
  };
  doc1 = await mk(A, subjA, "cours1.txt");
  doc2 = await mk(A, subjA, "cours2.txt");
  docOther = await mk(A, subjA2, "reseaux.txt");
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

const text = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

describe("notes unifiées", () => {
  let personal: string, annotation: string;

  it("crée une note personnelle sans document", async () => {
    const n = await notes.createNote(A, { subjectId: subjA, title: "Ma fiche", content: text("Définitions de base") });
    personal = n.id;
    expect(n).toMatchObject({ kind: "PERSONAL", revision: 1, links: [] });
  });

  it("crée une annotation ancrée : citation conservée, nature déduite", async () => {
    const n = await notes.createNote(A, {
      subjectId: subjA,
      links: [{ documentId: doc1, page: 3, anchor: { quote: "une fonction récursive", rects: [{ x: 10, y: 20, w: 100, h: 12 }] } }],
    });
    annotation = n.id;
    expect(n.kind).toBe("ANNOTATION");
    expect(n.snippet).toContain("une fonction récursive");
    expect(n.links[0]).toMatchObject({ documentId: doc1, page: 3, documentName: "cours1" });
    expect(n.links[0].versionId).toBeTruthy();
  });

  it("une note peut référencer plusieurs documents ; la nature suit les liens", async () => {
    let n = await notes.addLink(A, personal, { documentId: doc1, page: 2 });
    expect(n.kind).toBe("DOCUMENT");
    n = await notes.addLink(A, personal, { documentId: doc2 });
    expect(n.links).toHaveLength(2);
    n = await notes.removeLink(A, personal, n.links[0].id);
    n = await notes.removeLink(A, personal, n.links[0].id);
    expect(n.kind).toBe("PERSONAL");
  });

  it("refuse un document d'une autre matière ou d'un autre utilisateur", async () => {
    await expect(notes.addLink(A, personal, { documentId: docOther })).rejects.toMatchObject({ status: 404 });
    await expect(notes.createNote(A, { subjectId: subjA, links: [{ documentId: "inconnu" }] })).rejects.toMatchObject({ status: 404 });
  });

  it("sauvegarde avec contrôle de révision (concurrence optimiste)", async () => {
    const r1 = await notes.updateNote(A, personal, { revision: 1, content: text("Version 2") });
    expect(r1.revision).toBe(2);
    await expect(notes.updateNote(A, personal, { revision: 1, content: text("Écrasement") })).rejects.toMatchObject({ status: 409, extra: { currentRevision: 2 } });
    expect((await notes.getNote(A, personal)).snippet).toBe("Version 2");
    const r2 = await notes.updateNote(A, personal, { revision: 2, title: "Titre modifié" });
    expect(r2.revision).toBe(3);
  });

  it("rejette un contenu invalide sans rien modifier", async () => {
    await expect(notes.updateNote(A, personal, { revision: 3, content: { type: "doc", content: [{ type: "iframe" }] } })).rejects.toMatchObject({ status: 422 });
    expect((await notes.getNote(A, personal)).revision).toBe(3);
  });

  it("liste avec filtres (nature, document, recherche titre/contenu)", async () => {
    const all = await notes.listNotes(A, { subjectId: subjA });
    expect(all.map((n) => n.id).sort()).toEqual([annotation, personal].sort());
    expect((await notes.listNotes(A, { subjectId: subjA, kind: "ANNOTATION" })).map((n) => n.id)).toEqual([annotation]);
    expect((await notes.listNotes(A, { subjectId: subjA, documentId: doc1 })).map((n) => n.id)).toEqual([annotation]);
    expect((await notes.listNotes(A, { subjectId: subjA, q: "RÉCURSIVE" })).map((n) => n.id)).toEqual([annotation]);
    expect((await notes.listNotes(A, { subjectId: subjA, q: "titre modifié" })).map((n) => n.id)).toEqual([personal]);
    expect(await notes.listNotes(A, { subjectId: subjA2 })).toEqual([]);
  });

  it("isole strictement les utilisateurs", async () => {
    await expect(notes.getNote(B, personal)).rejects.toMatchObject({ status: 404 });
    await expect(notes.updateNote(B, personal, { revision: 3, title: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(notes.deleteNote(B, personal)).rejects.toMatchObject({ status: 404 });
    await expect(notes.addLink(B, personal, { documentId: doc1 })).rejects.toMatchObject({ status: 404 });
    await expect(notes.listNotes(B, { subjectId: subjA })).rejects.toMatchObject({ status: 404 });
    await expect(notes.createNote(B, { subjectId: subjA })).rejects.toMatchObject({ status: 404 });
    await expect(notes.createNote(B, { subjectId: subjB, links: [{ documentId: doc1 }] })).rejects.toMatchObject({ status: 404 });
    expect(await notes.listNotes(B, { subjectId: subjB })).toEqual([]);
  });

  it("la suppression d'un document retire ses liens mais conserve la note et sa citation", async () => {
    await docsSvc.deleteDocuments(A, [doc1]);
    const n = await notes.getNote(A, annotation);
    expect(n.links).toEqual([]);
    expect(n.snippet).toContain("une fonction récursive");
  });

  it("supprime une note", async () => {
    await notes.deleteNote(A, personal);
    await expect(notes.getNote(A, personal)).rejects.toMatchObject({ status: 404 });
  });
});
