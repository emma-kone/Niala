// Parcours complet de bout en bout (services réels, base PGlite réelle, exécution isolée réelle).
// Seul le fournisseur d'IA est un FAUX de test (jamais utilisé en production).
// import → analyse → note → cartes → exercice (code validé par exécution) → tentatives → maîtrise →
// tableau de bord → laboratoire → isolation entre utilisateurs.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider } from "@/server/ai/provider";

type Db = typeof import("@/lib/db").db;
let db: Db;
let m: Record<string, any>; // services chargés dynamiquement (après la configuration de l'environnement)
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string, subj: string, docId: string, exerciseId: string;

function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const kids: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const pg = 4 + i * 2;
    kids.push(`${pg} 0 R`);
    const body = lines.map((l, k) => `BT /F1 12 Tf 50 ${740 - k * 20} Td (${l.replace(/[()\\]/g, "")}) Tj ET`).join("\n");
    objs[pg] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pg + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[pg + 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offs[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i] ?? "null"}\nendobj\n`;
  }
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const PAD = " Cette phrase explique encore le sujet du cours avec des mots varies pour atteindre la taille minimale requise.";
const COURSE = [
  ["CHAPITRE I : LES FONCTIONS", "I. Introduction", "Une fonction est un bloc de code reutilisable que l'on appelle par son nom." + PAD, "II. Les parametres", "Les parametres permettent de transmettre des valeurs a la fonction." + PAD],
  ["II. Recursivite", "Une fonction recursive est une fonction qui s'appelle elle-meme jusqu'a une condition d'arret." + PAD],
];
const QUOTE = "Une fonction est un bloc de code reutilisable que l'on appelle par son nom";

// ── Faux fournisseur : un comportement par type d'appel ──
const fake: AiProvider = {
  name: "fake-test",
  model: "fake-model",
  async complete(req) {
    if (req.user.includes("[[SECTION")) {
      const ids = [...req.user.matchAll(/\[\[SECTION (\d+)\]\]/g)].map((x) => Number(x[1]));
      return { model: "fake-model", text: JSON.stringify({ sections: ids.map((id, i) => ({ id, concepts: i === 1 ? [{ name: "Fonction", kind: "DEFINITION", importance: 3, definition: "Bloc de code réutilisable", quote: QUOTE }] : [] })), relations: [] }) };
    }
    const slots = req.user.match(/Créneaux à remplir :\n(\[[\s\S]*?\])\n\nFormat/);
    if (slots) {
      const list = JSON.parse(slots[1]) as { slot: number; type: string }[];
      const base = (s: { slot: number; type: string }) => ({ slot: s.slot, type: s.type, statement: `Question ${s.slot} sur les fonctions ?`, source: { quote: QUOTE }, concepts: ["Fonction"], explanation: "Voir le cours." });
      const questions = list.map((s) => {
        if (s.type === "true_false") return { ...base(s), answer: true };
        if (s.type === "short_answer") return { ...base(s), accepted: ["bloc de code"] };
        return {
          ...base(s),
          statement: "Écrivez double(n) qui renvoie le double de n.",
          language: "javascript",
          referenceSolution: "function double(n){ return n * 2; }",
          criteria: ["Définit double", "Retourne n*2"],
          tests: [
            { name: "positif", call: { fn: "double", args: [2] }, expected: 4 },
            { name: "zéro", call: { fn: "double", args: [0] }, expected: 0, edge: true },
            { name: "attendu faux", call: { fn: "double", args: [5] }, expected: 99 },
          ],
        };
      });
      return { model: "fake-model", text: JSON.stringify({ questions, insufficient: [] }) };
    }
    return { model: "fake-model", text: "{}" };
  },
};

beforeAll(async () => {
  pg = await PGlite.create();
  for (const n of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261105000000_niala_diagnosis", "20261106000000_niala_progression", "20261107000000_niala_followups", "20261108000000_niala_exercise_sources", "20261109000000_niala_chat_attachments"]) {
    await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "migrations", n, "migration.sql"), "utf8"));
  }
  const port = 45000 + Math.floor(Math.random() * 4000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "sf-journey-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.GEMINI_API_KEY = ""; // vide (et non supprimé) : Prisma recharge .env sinon
  db = (await import("@/lib/db")).db;
  m = {
    docs: await import("@/server/services/documents"),
    folders: await import("@/server/services/folders"),
    analysis: await import("@/server/services/analysis/analysis-service"),
    notes: await import("@/server/services/notes"),
    maps: await import("@/server/services/maps"),
    gen: await import("@/server/services/exercises/generation"),
    att: await import("@/server/services/exercises/attempts"),
    labs: await import("@/server/services/labs/labs"),
    prog: await import("@/server/services/progress/progress"),
    prov: await import("@/server/ai/provider"),
  };
  m.prov.__setProviderForTests(fake);
  A = (await db.user.create({ data: { email: "etudiant@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "autre@x.fr", passwordHash: "x" } })).id;
  subj = (await db.subject.create({ data: { userId: A, name: "Algorithmique" } })).id;
}, 120_000);

afterAll(async () => {
  m?.prov?.__setProviderForTests(undefined);
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("parcours complet d'un étudiant", () => {
  it("1. organise et importe : dossier libre, fichier original conservé, texte indexé par page", async () => {
    const folder = await m.folders.createFolder(A, { subjectId: subj, name: "Cours", parentId: null });
    const data = makePdf(COURSE);
    const [r] = await m.docs.prepareUploads(A, { subjectId: subj, folderId: folder.id, files: [{ name: "fonctions.pdf", size: data.length }] });
    expect(r.ok).toBe(true);
    await m.docs.receiveLocalUpload(A, r.versionId, data);
    const fin = await m.docs.finalizeUpload(A, r.versionId);
    expect(fin.ok).toBe(true);
    docId = r.documentId;
    const original = await m.docs.openOriginal(A, docId);
    const { getStorage } = await import("@/server/storage");
    expect(Buffer.from(await getStorage().read(original.key)).equals(data)).toBe(true); // octet pour octet
    const doc = await db.document.findUniqueOrThrow({ where: { id: docId }, include: { currentVersion: true } });
    expect(doc.folderId).toBe(folder.id);
    expect(doc.currentVersion!.extractStatus).toMatch(/READY|PARTIAL/);
    expect(await db.documentChunk.count({ where: { versionId: doc.currentVersionId! } })).toBeGreaterThan(0);
  }, 60_000);

  it("2. analyse hiérarchique : plan fidèle au document, notions citées et vérifiées", async () => {
    await m.analysis.runAnalysis(A, docId);
    const a = await m.analysis.getAnalysis(A, docId);
    expect(a.analysis.status).toBe("READY");
    expect(a.sections.map((s: { numbering: string }) => s.numbering)).toEqual(expect.arrayContaining(["I", "II"]));
    expect(a.sections.every((s: { origin: string }) => s.origin === "DOCUMENT")).toBe(true);
    expect(a.concepts.map((c: { name: string }) => c.name)).toContain("Fonction");
  }, 60_000);

  it("3. notes : note de résumé liée au passage, sauvegarde avec révision (409 en cas de conflit)", async () => {
    const note = await m.notes.createNote(A, { subjectId: subj, kind: "SUMMARY", title: "Résumé", links: [{ documentId: docId, anchor: { page: 1, quote: QUOTE } }] });
    expect(note.links).toHaveLength(1);
    const saved = await m.notes.updateNote(A, note.id, { revision: note.revision, title: "Résumé v2" });
    await expect(m.notes.updateNote(A, note.id, { revision: note.revision, title: "périmé" })).rejects.toMatchObject({ status: 409 });
    expect(saved.revision).toBe(note.revision + 1);
  }, 60_000);

  it("4. cartes : structure issue du document + carte conceptuelle, provenance décidée par le serveur", async () => {
    const analysis = await db.documentAnalysis.findFirstOrThrow({ where: { userId: A, status: "READY" } });
    const structure = await m.maps.generateStructureMap(A, analysis.id);
    const concepts = await m.maps.generateConceptMap(A, analysis.id);
    const s = await m.maps.getMap(A, structure.id);
    expect(s.nodes.length).toBeGreaterThan(2);
    expect(s.nodes.every((n: { origin: string }) => n.origin === "DOCUMENT")).toBe(true);
    expect((await m.maps.getMap(A, concepts.id)).nodes.some((n: { label: string }) => n.label === "Fonction")).toBe(true);
  }, 60_000);

  it("5. exercice : source unique, barème exact, tests de code validés par exécution isolée", async () => {
    const r = await m.gen.generateExercise(A, { documentId: docId, questionCount: 3, totalPoints: 10, types: ["true_false", "short_answer", "code"], coverage: { mode: "all" }, difficulty: "melangee" });
    expect(r.created).toBe(3);
    exerciseId = r.id;
    const ex = await db.exercise.findUniqueOrThrow({ where: { id: r.id }, include: { questions: { orderBy: { position: "asc" } } } });
    expect(Math.round(ex.questions.reduce((t, q) => t + q.points, 0) * 100) / 100).toBe(10);
    const code = ex.questions.find((q) => q.type === "code")!;
    const key = code.answerKey as { verified: boolean; tests: { name: string }[] };
    expect(key.verified).toBe(true);
    expect(key.tests.map((t) => t.name)).toEqual(["positif", "zéro"]); // le test « attendu faux » a été écarté à l'exécution
    expect(r.notice ?? "").toMatch(/incohérent|écart|^$/);
  }, 120_000);

  const solve = async (ok: boolean) => {
    const { id } = await m.att.startAttempt(A, exerciseId, { fresh: true });
    const ex = await db.question.findMany({ where: { exerciseId }, orderBy: { position: "asc" } });
    for (const q of ex) {
      const value = q.type === "true_false" ? ok : q.type === "short_answer" ? (ok ? "bloc de code" : "rien") : ok ? "function double(n){ return n * 2; }" : "function double(n){ return 0; }";
      await m.att.saveAnswer(A, id, q.position, value);
    }
    return m.att.submitAttempt(A, id);
  };

  it("6. tentative réussie : correction objective + tests exécutés, maîtrise avec confiance prudente", async () => {
    const r = await solve(true);
    expect(r.status).toBe("GRADED");
    expect(r.score).toBe(10);
    const concept = await db.concept.findFirstOrThrow({ where: { userId: A, normalizedName: "fonction" }, include: { mastery: true } });
    expect(concept.mastery!.evidenceCount).toBe(3);
    expect(concept.mastery!.confidence).toBeLessThan(0.55); // une seule tentative : jamais « solide » affirmé
  }, 120_000);

  it("7. tentatives ratées : la maîtrise baisse, diagnostic des erreurs de code, recommandations justifiées", async () => {
    const before = (await db.conceptMastery.findFirstOrThrow({ where: { userId: A } })).level;
    await solve(false);
    await solve(false);
    await solve(false);
    const after = await db.conceptMastery.findFirstOrThrow({ where: { userId: A } });
    expect(after.level).toBeLessThan(before);
    expect(after.confidence).toBeGreaterThanOrEqual(0.35);
    expect(await db.errorDiagnosis.count({ where: { userId: A, answerId: { not: null } } })).toBeGreaterThan(0);
    const recs = await m.prog.listRecommendations(A);
    expect(recs[0]).toMatchObject({ type: "EXERCISE", subjectId: subj });
    expect(recs[0].documentId).toBe(docId);
    expect(recs[0].text).toMatch(/Fonction/);
  }, 180_000);

  it("8. laboratoire : la question de code s'ouvre en exercice, tests objectifs, solution débloquée après réussite", async () => {
    const w = await m.labs.createFromQuestion(A, { exerciseId, position: 3 });
    expect(JSON.stringify(w)).not.toContain("n * 2"); // la référence reste côté serveur
    await expect(m.labs.revealSolution(A, w.id)).rejects.toMatchObject({ status: 409 });
    const bad = await m.labs.runWorkspace(A, w.id, { mode: "tests", content: "function double(n){ return 0; }" });
    expect(bad.tests.summary.allPassed).toBe(false);
    const good = await m.labs.runWorkspace(A, w.id, { mode: "tests", content: "function double(n){ return n + n; }" });
    expect(good.tests.summary.allPassed).toBe(true);
    expect((await m.labs.revealSolution(A, w.id)).reference).toContain("n * 2");
  }, 120_000);

  it("9. tableau de bord : où j'en suis, ce qui demande attention, prochaine activité", async () => {
    const d = await m.prog.dashboard(A);
    expect(d.subjects[0]).toMatchObject({ name: "Algorithmique", documents: 1, exercises: 1 });
    expect(d.subjects[0].concepts.measured).toBe(1);
    expect(d.recent.length).toBeGreaterThan(0);
    expect(d.next ?? d.resume).not.toBeNull();
  });

  it("10. isolation : un autre étudiant ne voit et ne touche rien", async () => {
    const d = await m.prog.dashboard(B);
    expect(d).toMatchObject({ hasData: false, recent: [], next: null });
    await expect(m.docs.openOriginal(B, docId)).rejects.toMatchObject({ status: 404 });
    await expect(m.att.startAttempt(B, exerciseId)).rejects.toMatchObject({ status: 404 });
    await expect(m.labs.createFromQuestion(B, { exerciseId, position: 3 })).rejects.toMatchObject({ status: 404 });
    await expect(m.gen.generateExercise(B, { documentId: docId, questionCount: 3, totalPoints: 10, types: ["true_false"], coverage: { mode: "all" }, difficulty: "melangee" })).rejects.toMatchObject({ status: 404 });
    expect(await m.notes.listNotes(B, { subjectId: subj }).catch((e: { status: number }) => e.status)).toBe(404);
  });
});
