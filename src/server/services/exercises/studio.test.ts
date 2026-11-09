// Tests d'intégration : génération libre, reproduction d'un sujet, tuteur, exercices ponctuels. Fournisseur IA simulé.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider, CompletionRequest } from "@/server/ai/provider";

type Db = typeof import("@/lib/db").db;
let db: Db;
let docs: typeof import("@/server/services/documents");
let gen: typeof import("./generation");
let imp: typeof import("./import");
let att: typeof import("./attempts");
let tutor: typeof import("./tutor");
let prov: typeof import("@/server/ai/provider");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string;

const SUBJECT_TEXT = `Exercice 1 : Algebre relationnelle. Soit la table Etudiant donnee ci-dessous pour la suite de cet exercice complet.
1. Donner la definition precise de la cle primaire dans le modele relationnel.
2. Quelle commande SQL permet de lire des lignes dans une table ?
Remplissage du document pour atteindre une longueur suffisante afin que le texte soit considere comme lisible par le service d'extraction.
Remplissage du document pour atteindre une longueur suffisante afin que le texte soit considere comme lisible par le service d'extraction.`;

let calls: CompletionRequest[] = [];
let tutorReply = "Regardez ce qui identifie chaque ligne de la table.";

const fake: AiProvider = {
  name: "fake",
  model: "fake-model",
  async complete(req) {
    calls.push(req);
    if (req.system.includes("Tu es le tuteur")) return { model: "fake-model", text: JSON.stringify({ message: tutorReply }) };
    if (req.system.includes("Tu reproduis fidèlement")) {
      return {
        model: "fake-model",
        text: JSON.stringify({
          found: true,
          exercises: [{
            title: "Exercice 1",
            instructions: "Algebre relationnelle",
            context: "| id | nom |\n|---|---|\n| 1 | Awa |",
            questions: [
              { label: "1", type: "open", statement: "Donner la definition precise de la cle primaire.", source: { quote: "Donner la definition precise de la cle primaire" }, reference: "Attribut identifiant chaque ligne.", criteria: ["Unicite", "Identification"], fromDocument: false, points: 3, explanation: "Definition du cours.", concepts: ["Cle primaire"] },
              { label: "2", type: "short_answer", statement: "Quelle commande SQL permet de lire des lignes ?", source: { quote: "Quelle commande SQL permet de lire des lignes" }, accepted: ["SELECT"], fromDocument: true, points: 1, concepts: ["SQL"] },
              { label: "3", type: "open", statement: "Question inventee absente du sujet original.", source: { quote: "Cette citation n'existe pas dans le document" }, reference: "x y z a b", criteria: ["a", "b"], fromDocument: false },
            ],
          }],
        }),
      };
    }
    const slots = JSON.parse(req.user.split("Créneaux à remplir :\n")[1].split("\n")[0]) as { slot: number; type: string }[];
    return {
      model: "fake-model",
      text: JSON.stringify({
        questions: slots.map((s) => ({ slot: s.slot, type: "qcm_single", statement: `Question libre numero ${s.slot} sur les jointures ?`, options: ["Bonne option longue", "Autre", "Encore", "Dernier"], correctIndex: 0, concepts: ["Jointure"], explanation: "Parce que." })),
        insufficient: [],
      }),
    };
  },
};

function pdf(text: string): Buffer {
  const lines = text.split("\n").map((l, k) => `BT /F1 10 Tf 40 ${740 - k * 20} Td (${l.replace(/[()]/g, "")}) Tj ET`).join("\n");
  const objs = ["", "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R] /Count 1 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2000 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>", `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offs[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

async function upload(user: string) {
  const data = pdf(SUBJECT_TEXT);
  const [r] = await docs.prepareUploads(user, { subjectId: null, folderId: null, files: [{ name: "sujet.pdf", size: data.length }] });
  if (!r.ok) throw new Error(r.error);
  await docs.receiveLocalUpload(user, r.versionId, data);
  await docs.finalizeUpload(user, r.versionId);
  return r.documentId;
}

const FREE = { source: "free", subject: "Bases de données", chapter: "Jointures", level: "L3", questionCount: 3, totalPoints: 20, types: ["qcm_single"], difficulty: "moyenne" };

beforeAll(async () => {
  pg = await PGlite.create();
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(root).filter((n) => /^\d/.test(n) && !n.includes("v2_rls")).sort()) await pg.exec(readFileSync(path.join(root, name, "migration.sql"), "utf8"));
  const port = 54000 + Math.floor(Math.random() * 4000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-studio-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.GEMINI_API_KEY = "";
  db = (await import("@/lib/db")).db;
  docs = await import("@/server/services/documents");
  gen = await import("./generation");
  imp = await import("./import");
  att = await import("./attempts");
  tutor = await import("./tutor");
  prov = await import("@/server/ai/provider");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x", settings: { create: {} } } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x", settings: { create: {} } } })).id;
}, 120_000);

afterAll(async () => {
  prov?.__setProviderForTests(undefined);
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  tutorReply = "Regardez ce qui identifie chaque ligne de la table.";
  prov.__setProviderForTests(fake);
});

describe("génération libre", () => {
  it("crée un exercice sans matière ni document, et le signale", async () => {
    const r = await gen.generateFreeExercise(A, FREE);
    expect(r).toMatchObject({ subjectId: null, created: 3 });
    expect(r.notice).toContain("sans document");
    const list = await att.listExercises(A, {});
    expect(list.find((e) => e.id === r.id)).toMatchObject({ origin: "FREE", subject: null, freeSubject: "Bases de données" });
    expect(await db.subject.count({ where: { userId: A } })).toBe(0);
  });
  it("transmet le niveau et la langue choisie", async () => {
    await db.userSettings.update({ where: { userId: A }, data: { exerciseLang: "en" } });
    await gen.generateFreeExercise(A, FREE);
    expect(calls[0].user).toContain("Licence 3");
    expect(calls[0].user).toContain("anglais");
    await db.userSettings.update({ where: { userId: A }, data: { exerciseLang: "fr" } });
  });
  it("rattache l'exercice à une matière déjà enregistrée sous ce nom", async () => {
    const s = await db.subject.create({ data: { userId: B, name: "Bases de donnees" } });
    expect((await gen.generateFreeExercise(B, FREE)).subjectId).toBe(s.id);
  });
  it("transmet un niveau « Autre » précisé par l'étudiant, et l'exige", async () => {
    await expect(gen.generateFreeExercise(A, { ...FREE, level: "AUTRE" })).rejects.toMatchObject({ status: 422 });
    const r = await gen.generateFreeExercise(A, { ...FREE, level: "AUTRE", levelOther: "Terminale D" });
    expect(calls.at(-1)!.user).toContain("Terminale D");
    expect((await att.getExercise(A, r.id)).config.free).toMatchObject({ level: "Terminale D" });
  });
  it("refuse une configuration incomplète", async () => {
    await expect(gen.generateFreeExercise(A, { ...FREE, chapter: "" })).rejects.toMatchObject({ status: 422 });
  });
  it("permet de passer l'exercice jusqu'à sa correction", async () => {
    const { id } = await gen.generateFreeExercise(A, FREE);
    const attempt = await att.startAttempt(A, id);
    const detail = await att.getAttempt(A, attempt.id);
    const q = detail.questions[0];
    const good = (q.payload.options as { id: string; label: string }[]).find((o) => o.label === "Bonne option longue")!.id;
    await att.saveAnswer(A, attempt.id, 1, good);
    const graded = await att.submitAttempt(A, attempt.id);
    expect(graded.status).toBe("GRADED");
    expect(graded.questions[0].result?.verdict).toBe("correct");
  });
});

describe("exercice ponctuel", () => {
  it("n'apparaît pas dans Mes exercices, et peut y être ajouté", async () => {
    const r = await gen.generateFreeExercise(A, { ...FREE, saved: false });
    expect((await att.listExercises(A, {})).some((e) => e.id === r.id)).toBe(false);
    await att.setExerciseSaved(A, r.id, true);
    expect((await att.listExercises(A, {})).some((e) => e.id === r.id)).toBe(true);
  });
  it("est purgé après 24 h, sauf si une tentative récente est en cours", async () => {
    const old = await gen.generateFreeExercise(A, { ...FREE, saved: false });
    const active = await gen.generateFreeExercise(A, { ...FREE, saved: false });
    await att.startAttempt(A, active.id);
    await db.exercise.updateMany({ where: { id: { in: [old.id, active.id] } }, data: { createdAt: new Date(Date.now() - 48 * 3600 * 1000) } });
    await att.purgeOccasionalExercises(A);
    expect(await db.exercise.count({ where: { id: old.id } })).toBe(0);
    expect(await db.exercise.count({ where: { id: active.id } })).toBe(1);
  });
});

describe("reproduction d'un sujet", () => {
  it("structure les exercices, rejette ce qui n'est pas dans le document", async () => {
    const documentId = await upload(A);
    const r = await imp.importExercises(A, { documentId });
    expect(r).toMatchObject({ created: 2, exercises: 1 });
    expect(r.notice).toContain("proposé par l'IA");
    const attempt = await att.startAttempt(A, r.id);
    const detail = await att.getAttempt(A, attempt.id);
    expect(detail.questions[0].payload).toMatchObject({ label: "1", rich: true, group: { title: "Exercice 1", instructions: "Algebre relationnelle" } });
    expect(String((detail.questions[0].payload.group as { context: string }).context)).toContain("| id | nom |");
    expect(JSON.stringify(detail.questions)).not.toContain("SELECT");
    const ex = await att.getExercise(A, r.id);
    expect(ex).toMatchObject({ origin: "IMPORTED", subject: null });
    expect(ex.questions.map((q) => q.points)).toEqual([15, 5]);
  });
  it("retire le fichier avec le dernier exercice qui l'utilise", async () => {
    const documentId = await upload(A);
    const r = await imp.importExercises(A, { documentId });
    await att.deleteExercise(A, r.id);
    expect(await db.document.count({ where: { id: documentId } })).toBe(0);
  });
  it("refuse le document d'un autre compte", async () => {
    const documentId = await upload(A);
    await expect(imp.importExercises(B, { documentId })).rejects.toMatchObject({ status: 404 });
  });
});

describe("tuteur", () => {
  async function startImported(mode?: string) {
    const r = await imp.importExercises(A, { documentId: await upload(A), mode, correctionMode: "immediate" });
    return (await att.startAttempt(A, r.id)).id;
  }

  it("guide sans corrigé tant que la question n'est pas corrigée, et garde la conversation", async () => {
    const id = await startImported();
    const first = await tutor.askTutor(A, id, { position: 1, kind: "hint" });
    expect(first.messages.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(first.allowed).not.toContain("correction");
    expect(calls.at(-1)!.user).toContain("MODE ACCOMPAGNEMENT");
    expect(calls.at(-1)!.user).toContain("Niveau 1");
    await tutor.askTutor(A, id, { position: 1, kind: "hint" });
    expect(calls.at(-1)!.user).toContain("Niveau 2");
    expect(calls.at(-1)!.user).toContain("Regardez ce qui identifie");
  });

  it("remplace une réponse qui révèlerait le corrigé", async () => {
    const id = await startImported();
    tutorReply = "La commande à utiliser est SELECT, tout simplement.";
    const s = await tutor.askTutor(A, id, { position: 2, kind: "free", message: "Donne la réponse" });
    expect(s.messages.at(-1)!.content).not.toContain("SELECT");
  });

  it("refuse la correction détaillée avant la correction, l'accepte ensuite", async () => {
    const id = await startImported();
    await expect(tutor.askTutor(A, id, { position: 2, kind: "correction" })).rejects.toMatchObject({ status: 403 });
    await att.checkAnswer(A, id, 2, "SELECT");
    tutorReply = "SELECT est la commande de lecture : voici pourquoi.";
    const s = await tutor.askTutor(A, id, { position: 2, kind: "correction" });
    expect(s.revealed).toBe(true);
    expect(s.messages.at(-1)!.content).toContain("SELECT");
    expect(calls.at(-1)!.user).toContain("MODE CORRECTION");
  });

  it("n'aide pas en mode examen", async () => {
    const id = await startImported("examen");
    expect((await tutor.tutorState(A, id, 1)).allowed).toEqual([]);
    await expect(tutor.askTutor(A, id, { position: 1, kind: "hint" })).rejects.toMatchObject({ status: 403 });
  });

  it("limite l'entraînement aux indices et clarifications, et respecte le réglage des indices", async () => {
    const id = await startImported("entrainement");
    expect((await tutor.tutorState(A, id, 1)).allowed).toEqual(["hint", "clarify"]);
    await db.userSettings.update({ where: { userId: A }, data: { hintsEnabled: false } });
    expect((await tutor.tutorState(A, id, 1)).allowed).toEqual(["clarify"]);
    await expect(tutor.askTutor(A, id, { position: 1, kind: "hint" })).rejects.toMatchObject({ status: 403 });
    await db.userSettings.update({ where: { userId: A }, data: { hintsEnabled: true } });
  });

  it("isole les conversations par compte", async () => {
    const id = await startImported();
    await expect(tutor.tutorState(B, id, 1)).rejects.toMatchObject({ status: 404 });
  });
});
