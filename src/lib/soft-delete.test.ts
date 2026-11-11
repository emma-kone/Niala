// Suppression douce : ce que l'étudiant supprime disparaît pour lui mais reste en base pour les statistiques.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let lib: typeof import("@/lib/db");
let soft: typeof import("@/lib/soft-delete");
let documents: typeof import("@/server/services/documents");
let folders: typeof import("@/server/services/folders");
let attempts: typeof import("@/server/services/exercises/attempts");
let notes: typeof import("@/server/services/notes");
let A: string;

beforeAll(async () => {
  process.env.STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), "niala-soft-"));
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  ctx = await startTestDb();
  lib = await import("@/lib/db");
  soft = await import("@/lib/soft-delete");
  documents = await import("@/server/services/documents");
  folders = await import("@/server/services/folders");
  attempts = await import("@/server/services/exercises/attempts");
  notes = await import("@/server/services/notes");
  A = (await lib.dbAll.user.create({ data: { email: "soft@x.fr", passwordHash: "x", settings: { create: {} } } })).id;
}, 90_000);

afterAll(async () => {
  await ctx?.stop();
});

const newSubject = (name = "Algorithmique") => lib.db.subject.create({ data: { userId: A, name } });
async function newDocument(subjectId: string, folderId: string | null = null) {
  const doc = await lib.db.document.create({ data: { userId: A, subjectId, folderId, name: "Cours.pdf", originalName: "Cours.pdf", type: "pdf", size: 10 } });
  await lib.db.documentVersion.create({ data: { userId: A, documentId: doc.id, number: 1, mime: "application/pdf", size: 10 } });
  return doc;
}

describe("protection", () => {
  it("refuse toute suppression définitive d'un contenu par le client de l'application", async () => {
    const s = await newSubject("Protégée");
    await expect(lib.db.subject.delete({ where: { id: s.id } })).rejects.toBeInstanceOf(soft.HardDeleteError);
    await expect(lib.db.note.deleteMany({ where: { userId: A } })).rejects.toBeInstanceOf(soft.HardDeleteError);
    expect(await lib.db.subject.count({ where: { id: s.id } })).toBe(1);
  });
});

describe("documents", () => {
  it("un document supprimé disparaît (avec ses versions et liens de notes) mais reste en base", async () => {
    const s = await newSubject("Réseaux");
    const doc = await newDocument(s.id);
    const note = await lib.db.note.create({ data: { userId: A, subjectId: s.id, content: {} } });
    await lib.db.noteLink.create({ data: { userId: A, noteId: note.id, documentId: doc.id } });
    await documents.deleteDocuments(A, [doc.id]);

    expect(await lib.db.document.findFirst({ where: { id: doc.id } })).toBeNull();
    expect(await lib.db.documentVersion.count({ where: { documentId: doc.id } })).toBe(0);
    expect((await notes.getNote(A, note.id)).links).toEqual([]);
    const kept = await lib.dbAll.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(kept.deletedAt).toBeInstanceOf(Date);
    expect(kept.subjectId).toBe(s.id); // le lien utile aux statistiques est conservé
    expect(await lib.dbAll.documentVersion.count({ where: { documentId: doc.id } })).toBe(1);
    expect((await lib.dbAll.noteLink.findFirstOrThrow({ where: { documentId: doc.id } })).deletedAt).toBeInstanceOf(Date);
    await expect(documents.deleteDocuments(A, [doc.id])).rejects.toMatchObject({ status: 404 });
  });
});

describe("matières", () => {
  it("une matière supprimée emporte ses contenus pour l'étudiant ; les liens « SetNull » sont retirés comme avant", async () => {
    const s = await newSubject("Bases de données");
    const ex = await lib.db.exercise.create({ data: { userId: A, subjectId: s.id, title: "QCM", config: {}, totalPoints: 10 } });
    const note = await lib.db.note.create({ data: { userId: A, subjectId: s.id, content: {} } });
    const event = await lib.db.scheduleEvent.create({ data: { userId: A, subjectId: s.id, title: "Cours BD", date: "2026-11-12", startMinutes: 480, endMinutes: 600 } });
    await lib.db.$transaction((tx) => soft.softDelete(tx, "Subject", { id: s.id, userId: A }));

    expect(await lib.db.subject.count({ where: { id: s.id } })).toBe(0);
    expect(await lib.db.exercise.count({ where: { id: ex.id } })).toBe(0);
    expect(await lib.db.note.count({ where: { id: note.id } })).toBe(0);
    // Le cours d'agenda reste visible, détaché de la matière supprimée, exactement comme avant.
    expect((await lib.db.scheduleEvent.findUniqueOrThrow({ where: { id: event.id } })).subjectId).toBeNull();
    // Tout reste en base, marqué supprimé, avec ses liens.
    expect((await lib.dbAll.exercise.findUniqueOrThrow({ where: { id: ex.id } })).deletedAt).toBeInstanceOf(Date);
    expect((await lib.dbAll.note.findUniqueOrThrow({ where: { id: note.id } })).subjectId).toBe(s.id);
  });
});

describe("dossiers", () => {
  it("un dossier supprimé libère son nom et masque ses documents", async () => {
    const s = await newSubject("Systèmes");
    const folderId = (await folders.createFolder(A, { subjectId: s.id, parentId: null, name: "TD" })).id;
    const doc = await newDocument(s.id, folderId);
    await folders.deleteFolder(A, folderId);
    expect(await lib.db.document.count({ where: { id: doc.id } })).toBe(0);
    expect(await lib.dbAll.folder.count({ where: { id: folderId, deletedAt: { not: null } } })).toBe(1);
    await expect(folders.createFolder(A, { subjectId: s.id, parentId: null, name: "TD" })).resolves.toBeTruthy();
  });
});

describe("exercices", () => {
  it("un exercice supprimé garde ses tentatives et leur lien pour les statistiques", async () => {
    const ex = await lib.db.exercise.create({ data: { userId: A, title: "Récursivité", config: {}, totalPoints: 5, saved: true } });
    const att = await lib.db.exerciseAttempt.create({ data: { userId: A, exerciseId: ex.id, snapshot: {}, status: "GRADED", score: 4, maxScore: 5, finishedAt: new Date() } });
    await attempts.deleteExercise(A, ex.id);
    await expect(attempts.deleteExercise(A, ex.id)).rejects.toMatchObject({ status: 404 });
    expect(await lib.db.exercise.count({ where: { id: ex.id } })).toBe(0);
    expect((await lib.dbAll.exerciseAttempt.findUniqueOrThrow({ where: { id: att.id } })).exerciseId).toBe(ex.id);
  });
});

describe("filtre « visible »", () => {
  it("couvre les ancêtres reliés en cascade", () => {
    expect(soft.aliveFilter("Document")).toEqual({ deletedAt: null });
    expect(JSON.stringify(soft.aliveFilter("DocumentChunk"))).toContain('"document":{"is":{"deletedAt":null}}');
    expect(soft.aliveFilter("AdminAuditLog")).toBeNull();
    expect(soft.withAlive("Document", { id: "x", deletedAt: { not: null } })).toEqual({ id: "x", deletedAt: { not: null } });
  });
});
