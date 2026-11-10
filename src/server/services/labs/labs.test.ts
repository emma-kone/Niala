// Tests d'intégration des laboratoires : vraie exécution isolée (QuickJS, sql.js, Pyodide), vraie base PGlite.
// Le fournisseur IA est un FAUX de test (jamais utilisé en production).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider, CompletionRequest } from "@/server/ai/provider";

type Db = typeof import("@/lib/db").db;
let db: Db;
let labs: typeof import("./labs");
let docs: typeof import("@/server/services/documents");
let evaluation: typeof import("@/server/services/exercises/evaluation");
let prov: typeof import("@/server/ai/provider");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string, subj: string, exId: string;

function makePdf(lines: string[]): Buffer {
  const body = lines.map((l, k) => `BT /F1 12 Tf 50 ${740 - k * 20} Td (${l}) Tj ET`).join("\n");
  const objs = ["", "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R] /Count 1 >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>", `<< /Length ${body.length} >>\nstream\n${body}\nendstream`];
  let pdf = "%PDF-1.4\n";
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offs[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

// ── Faux fournisseur ──
let hintReply: "clean" | "codeblock" | "copy" = "clean";
let importPayload: unknown = { found: true, exercises: [] };
let calls: CompletionRequest[] = [];
const fake: AiProvider = {
  name: "fake-test",
  model: "fake-model",
  async complete(req) {
    calls.push(req);
    if (req.system.includes("Tu es un tuteur")) {
      const message = hintReply === "clean" ? "Regardez ce que votre fonction renvoie quand la liste est vide : que devrait-elle renvoyer d'après l'énoncé ?" : hintReply === "codeblock" ? "Voici la solution :\n```js\nfunction sum(a){ return a.reduce((x,y)=>x+y,0); }\n```" : "Essayez simplement ceci : let s = 0; for (const x of a) s += x; return s; et voilà";
      return { model: "fake-model", text: JSON.stringify({ message, concept: "cas limite", suspected: [{ category: "METHOD", rationale: "Le cas vide n'est pas traité." }] }) };
    }
    if (req.system.includes("Tu extrais d'un document")) return { model: "fake-model", text: JSON.stringify(importPayload) };
    return { model: "fake-model", text: "{}" };
  },
};

const SUM_TESTS = [
  { name: "somme simple", call: { fn: "sum", args: [[1, 2, 3]] }, expected: 6 },
  { name: "un seul élément", call: { fn: "sum", args: [[5]] }, expected: 5 },
  { name: "liste vide", call: { fn: "sum", args: [[]] }, expected: 0, edge: true },
  { name: "valeurs négatives (caché)", call: { fn: "sum", args: [[-1, -2]] }, expected: -3, hidden: true, edge: true },
];
const SUM_OK = "function sum(a){ let s = 0; for (const x of a) s += x; return s; }";
const SUM_BAD_EMPTY = "function sum(a){ return a.reduce((x, y) => x + y); }"; // plante sur la liste vide

const SQL_SETUP = "CREATE TABLE emp(id INTEGER PRIMARY KEY, nom TEXT, sal INTEGER); INSERT INTO emp(nom, sal) VALUES ('a', 10), ('b', 20), ('c', 30), ('d', 40), ('e', 50);";
const SQL_SPEC = { setupSql: SQL_SETUP, referenceSql: "SELECT nom FROM emp WHERE sal > (SELECT AVG(sal) FROM emp) ORDER BY nom;", checks: [], ordered: false, variants: [{ name: "salaires très élevés", extraSql: "INSERT INTO emp(nom, sal) VALUES ('f', 1000), ('g', 1000);" }], strictColumns: false };

async function makeQuestion(position: number, type: "code" | "sql", payload: object, answerKey: object) {
  return db.question.create({ data: { userId: A, exerciseId: exId, position, type, points: 4, difficulty: "moyenne", payload, answerKey, explanation: null, sourceRefs: [] } });
}

beforeAll(async () => {
  pg = await PGlite.create();
  for (const n of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261113000000_niala_google_link", "20261116000000_niala_profile_exercises", "20261117000000_niala_class_level_other", "20261118000000_niala_admin", "20261119000000_niala_langues_edt_reset", "20261120000000_niala_agenda_sections"]) {
    await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "migrations", n, "migration.sql"), "utf8"));
  }
  const port = 55000 + Math.floor(Math.random() * 4000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "sf-lab-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.GEMINI_API_KEY = ""; // vide (et non supprimé) : Prisma recharge .env sinon
  db = (await import("@/lib/db")).db;
  labs = await import("./labs");
  docs = await import("@/server/services/documents");
  evaluation = await import("@/server/services/exercises/evaluation");
  prov = await import("@/server/ai/provider");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
  subj = (await db.subject.create({ data: { userId: A, name: "Algo" } })).id;
  exId = (await db.exercise.create({ data: { userId: A, subjectId: subj, title: "Exercice test", totalPoints: 8, config: {} } })).id;
  await makeQuestion(1, "code", { statement: "Écrire sum(a) qui renvoie la somme d'une liste.", language: "javascript", starterCode: "// sum" }, { reference: SUM_OK, criteria: ["a", "b"], verified: true, tests: SUM_TESTS.map((t) => ({ hidden: false, weight: 1, edge: false, ...t })) });
  await makeQuestion(2, "sql", { statement: "Employés dont le salaire dépasse la moyenne.", setupSql: SQL_SETUP }, { reference: SQL_SPEC.referenceSql, criteria: ["a", "b"], verified: true, sql: SQL_SPEC });
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
  hintReply = "clean";
  prov.__setProviderForTests(undefined);
});

describe("mode libre", () => {
  it("exécute du JavaScript, enregistre l'exécution et diagnostique une erreur de syntaxe", async () => {
    const w = await labs.createFree(A, { kind: "CODE", language: "javascript", subjectId: subj });
    expect(w.mode).toBe("FREE");
    const ok = await labs.runWorkspace(A, w.id, { mode: "run", content: "console.log(6 * 7)" });
    expect(ok.output).toMatchObject({ status: "ok", stdout: "42\n" });
    expect(ok.diagnoses).toEqual([]);
    const bad = await labs.runWorkspace(A, w.id, { mode: "run", content: "let = ;" });
    expect(bad.diagnoses[0]).toMatchObject({ category: "SYNTAX" });
    const rows = await db.errorDiagnosis.findMany({ where: { userId: A, labRunId: bad.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "SYNTAX" });
    // le code enregistré est celui du dernier lancement ; l'historique est conservé
    expect((await labs.getWorkspace(A, w.id)).files[0].content).toBe("let = ;");
    expect((await labs.listRuns(A, w.id)).map((r) => r.mode)).toEqual(["run", "run"]);
    expect(await db.learningActivity.count({ where: { userId: A, refType: "lab", refId: w.id, type: "LAB_CODE" } })).toBe(1);
  }, 60_000);

  it("SQL libre : jeu d'exemple, schéma affiché, erreur classée, requête infinie interrompue", async () => {
    const w = await labs.createFree(A, { kind: "SQL", fixtureId: "entreprise" });
    const ok = await labs.runWorkspace(A, w.id, { content: "SELECT nom FROM employes ORDER BY salaire DESC LIMIT 2;" });
    const out = ok.output as { statements: { rows: unknown[][] }[]; schema: { name: string }[] };
    expect(out.statements[0].rows).toEqual([["Hugo Bernard"], ["Sophie Durand"]]);
    expect(out.schema.map((t) => t.name)).toEqual(["employes", "services"]);
    const syn = await labs.runWorkspace(A, w.id, { content: "SELEC nom FORM employes;" });
    expect(syn.diagnoses[0]).toMatchObject({ category: "SYNTAX" });
    const name = await labs.runWorkspace(A, w.id, { content: "SELECT prenom FROM employes;" });
    expect(name.diagnoses[0]).toMatchObject({ category: "INSTRUCTION", kind: "schema_name" });
  }, 60_000);

  it("Python libre", async () => {
    const w = await labs.createFree(A, { kind: "CODE", language: "python" });
    const r = await labs.runWorkspace(A, w.id, { content: "n = int(input())\nprint(n * 2)", stdin: "21\n" });
    expect(r.output).toMatchObject({ status: "ok", stdout: "42\n" });
    const e = await labs.runWorkspace(A, w.id, { content: "print(1/0)" });
    expect(e.output).toMatchObject({ status: "error", error: { type: "ZeroDivisionError", line: 1 } });
    expect(e.diagnoses[0]).toMatchObject({ category: "LOGIC", kind: "runtime" });
  }, 120_000);

  it("refuse un langage non exécutable et du code vide", async () => {
    await expect(labs.createFree(A, { kind: "CODE", language: "java" })).rejects.toMatchObject({ status: 422 });
    await expect(labs.createFree(A, { kind: "CODE", language: "sql" })).rejects.toMatchObject({ status: 422 });
    const w = await labs.createFree(A, { kind: "CODE", language: "javascript" });
    await expect(labs.runWorkspace(A, w.id, { content: "   " })).rejects.toMatchObject({ status: 422 });
  }, 60_000);
});

describe("mode exercice : code", () => {
  it("tests objectifs, test caché non divulgué, cas limite, révélation conditionnelle", async () => {
    const w = await labs.createFromQuestion(A, { exerciseId: exId, position: 1 });
    expect(w).toMatchObject({ mode: "EXERCISE", kind: "CODE", exerciseId: exId });
    // la solution et les valeurs attendues cachées ne quittent pas le serveur
    expect(JSON.stringify(w)).not.toContain("a.reduce");
    expect(JSON.stringify(w)).not.toContain("let s = 0");
    const hidden = w.brief!.tests.find((t) => t.hidden)!;
    expect(hidden.expected).toBeUndefined();
    expect(w.brief!.tests.find((t) => t.name === "somme simple")!.expected).toBe(6);
    expect((await labs.createFromQuestion(A, { exerciseId: exId, position: 1 })).id).toBe(w.id); // idempotent

    await expect(labs.revealSolution(A, w.id)).rejects.toMatchObject({ status: 409 });

    // plante sur la liste vide : les cas courants passent, pas le cas limite
    const r1 = await labs.runWorkspace(A, w.id, { mode: "tests", content: SUM_BAD_EMPTY });
    expect(r1.tests!.summary).toMatchObject({ passed: 3, total: 4, allPassed: false });
    const empty = r1.tests!.outcomes.find((o) => o.name === "liste vide")!;
    expect(empty).toMatchObject({ status: "error", edge: true, reason: "runtime" });
    const hid = r1.tests!.outcomes.find((o) => o.hidden)!;
    expect(hid.expected).toBeUndefined();
    expect(r1.diagnoses.some((d) => d.kind === "runtime")).toBe(true);
    expect(await db.errorDiagnosis.count({ where: { userId: A, labRunId: r1.id } })).toBeGreaterThan(0);

    const r2 = await labs.runWorkspace(A, w.id, { mode: "tests", content: "function sum(a){ return 0; }" });
    expect(r2.diagnoses[0]).toMatchObject({ category: "LOGIC", kind: "wrong_output" });
    const r3 = await labs.runWorkspace(A, w.id, { mode: "tests", content: "function somme(a){ return 0; }" });
    expect(r3.diagnoses.some((d) => d.category === "INSTRUCTION")).toBe(true);

    // 3 essais avec tests → la solution se débloque
    expect((await labs.getWorkspace(A, w.id)).canReveal).toBe(true);
    const win = await labs.runWorkspace(A, w.id, { mode: "tests", content: SUM_OK });
    expect(win.tests!.summary).toMatchObject({ passed: 4, total: 4, allPassed: true, ratio: 1 });
    expect(await db.learningActivity.findFirst({ where: { userId: A, refId: w.id } })).toMatchObject({ status: "DONE" });
    const rev = await labs.revealSolution(A, w.id);
    expect(rev.reference).toContain("let s = 0");
    expect((await labs.getWorkspace(A, w.id)).brief!.revealedAt).toBeTruthy();
  }, 120_000);

  it("boucle infinie dans un test : timeout classé, les autres tests s'exécutent", async () => {
    const w = await labs.createFromQuestion(A, { exerciseId: exId, position: 1 });
    const code = "function sum(a){ if (a.length === 0) { while (true) {} } let s = 0; for (const x of a) s += x; return s; }";
    const r = await labs.runWorkspace(A, w.id, { mode: "tests", content: code });
    expect(r.tests!.outcomes.find((o) => o.name === "liste vide")!.status).toBe("timeout");
    expect(r.tests!.summary.passed).toBe(3);
    expect(r.diagnoses.some((d) => d.kind === "timeout")).toBe(true);
  }, 120_000);
});

describe("mode exercice : SQL", () => {
  it("compare le résultat à la référence sur le jeu de l'énoncé et sur un jeu limite", async () => {
    const w = await labs.createFromQuestion(A, { exerciseId: exId, position: 2 });
    expect(JSON.stringify(w)).not.toContain("AVG(sal)");
    const good = await labs.runWorkspace(A, w.id, { mode: "tests", content: "SELECT nom FROM emp WHERE sal > (SELECT AVG(sal) FROM emp) ORDER BY nom;" });
    expect(good.tests!.summary).toMatchObject({ passed: 2, total: 2, allPassed: true });
    // « > 30 » donne le bon résultat sur le jeu de l'énoncé mais pas sur le jeu limite (moyenne différente)
    const hardcoded = await labs.runWorkspace(A, w.id, { mode: "tests", content: "SELECT nom FROM emp WHERE sal > 30;" });
    expect(hardcoded.tests!.outcomes.map((o) => o.status)).toEqual(["pass", "fail"]);
    expect(hardcoded.diagnoses[0]).toMatchObject({ kind: "edge_case" });
    const wrong = await labs.runWorkspace(A, w.id, { mode: "tests", content: "SELECT nom FROM emp WHERE sal >= 30 ORDER BY nom;" });
    expect(wrong.tests!.outcomes[0]).toMatchObject({ status: "fail", reason: "rows_extra" });
    expect(wrong.diagnoses[0]).toMatchObject({ category: "LOGIC", kind: "wrong_output" });
    const cols = await labs.runWorkspace(A, w.id, { mode: "tests", content: "SELECT nom, sal FROM emp WHERE sal > 30;" });
    expect(cols.diagnoses[0]).toMatchObject({ category: "INSTRUCTION" });
    const err = await labs.runWorkspace(A, w.id, { mode: "tests", content: "SELECT nom FORM emp;" });
    expect(err.diagnoses[0]).toMatchObject({ category: "SYNTAX" });
  }, 120_000);
});

describe("exercices générés : correction par tests", () => {
  const key = (verified: boolean) => ({ reference: SUM_OK, criteria: ["a", "b"], verified, tests: SUM_TESTS.map((t) => ({ hidden: false, weight: 1, edge: false, ...t })) });
  const q = (verified: boolean) => ({ type: "code" as const, payload: { language: "javascript", statement: "…" }, answerKey: key(verified), points: 4 });

  it("note au prorata des tests réussis, sans IA, avec détail et diagnostic", async () => {
    const g = await evaluation.gradeAnswer(A, q(true), SUM_BAD_EMPTY);
    expect(g.method).toBe("tests");
    expect(g.points).toBe(3);
    expect(g.verdict).toBe("partial");
    expect(g.explanation).toMatch(/3 test\(s\) réussi\(s\) sur 4/);
    expect((g.detail as { diagnoses: unknown[] }).diagnoses.length).toBeGreaterThan(0);
    const full = await evaluation.gradeAnswer(A, q(true), SUM_OK);
    expect(full).toMatchObject({ points: 4, verdict: "correct", method: "tests" });
  }, 60_000);

  it("sans tests validés et sans IA : « non corrigée », jamais de note inventée", async () => {
    const g = await evaluation.gradeAnswer(A, q(false), SUM_OK);
    expect(g.verdict).toBe("ungraded");
    expect(g.points).toBeNull();
  });

  it("SQL : points selon les jeux de données réussis", async () => {
    const sq = (verified: boolean) => ({ type: "sql" as const, payload: { statement: "…" }, answerKey: { reference: SQL_SPEC.referenceSql, criteria: ["a", "b"], verified, sql: SQL_SPEC }, points: 2 });
    expect(await evaluation.gradeAnswer(A, sq(true), SQL_SPEC.referenceSql)).toMatchObject({ points: 2, verdict: "correct", method: "tests" });
    const half = await evaluation.gradeAnswer(A, sq(true), "SELECT nom FROM emp WHERE sal > 30;");
    expect(half).toMatchObject({ points: 1, verdict: "partial" });
  }, 60_000);
});

describe("indices", () => {
  it("sans IA : indice déterministe fondé sur les tests, jamais la solution", async () => {
    const fresh = await labs.createFree(A, { kind: "CODE", language: "javascript" });
    await expect(labs.hintFor(A, fresh.id, { level: 1 })).rejects.toMatchObject({ status: 409 }); // rien n'a été exécuté
    const w = await labs.createFromQuestion(A, { exerciseId: exId, position: 1 });
    await labs.runWorkspace(A, w.id, { mode: "tests", content: SUM_BAD_EMPTY });
    const h1 = await labs.hintFor(A, w.id, { level: 1 });
    expect(h1.source).toBe("tests");
    expect(h1.message).toMatch(/exception|erreur/i);
    expect(h1.message).not.toContain("let s = 0");
    const h3 = await labs.hintFor(A, w.id, { level: 3 });
    expect(h3.message).not.toBe(h1.message);
    await expect(labs.hintFor(A, w.id, { level: 4 })).rejects.toMatchObject({ status: 422 });
  }, 120_000);

  it("avec IA : indice IA accepté ; bloc de code ou ligne de la solution recopiée → repli, hypothèse enregistrée comme faible", async () => {
    prov.__setProviderForTests(fake);
    const w = await labs.createFromQuestion(A, { exerciseId: exId, position: 1 });
    const run = await labs.runWorkspace(A, w.id, { mode: "tests", content: SUM_BAD_EMPTY });
    const ai = await labs.hintFor(A, w.id, { level: 2 });
    expect(ai.source).toBe("ai");
    expect(calls.at(-1)!.user).toContain("CONFIDENTIELLE");
    const s = await db.errorDiagnosis.findFirst({ where: { userId: A, labRunId: run.id, category: "METHOD" } });
    expect(s).toBeTruthy();
    expect(s!.confidence).toBeLessThanOrEqual(0.6);
    expect(JSON.stringify(s!.evidence)).toContain('"source":"ai"');

    hintReply = "codeblock";
    expect((await labs.hintFor(A, w.id, { level: 3 })).source).toBe("tests");
    hintReply = "copy";
    expect((await labs.hintFor(A, w.id, { level: 3 })).source).toBe("tests");
  }, 120_000);
});

describe("import d'un document d'énoncés", () => {
  const TEXT = ["TRAVAUX PRATIQUES 1", "Exercice 1 : ecrire une fonction double(n) qui renvoie le double du nombre n donne en parametre.", "Exercice 2 : ecrire une fonction triple(n) qui renvoie le triple du nombre n.", "Les etudiants rendront leurs travaux en fin de seance."];
  let docId: string;
  beforeAll(async () => {
    const data = makePdf(TEXT);
    const [r] = await docs.prepareUploads(A, { subjectId: subj, folderId: null, files: [{ name: "tp1.pdf", size: data.length }] });
    if (!r.ok) throw new Error("prepare");
    await docs.receiveLocalUpload(A, r.versionId, data);
    await docs.finalizeUpload(A, r.versionId);
    docId = r.documentId;
  }, 60_000);

  it("refuse sans IA", async () => {
    await expect(labs.createFromDocument(A, { documentId: docId, kind: "CODE", language: "javascript" })).rejects.toMatchObject({ status: 503 });
  });

  it("énoncés cités dans le document ; tests validés par la solution de référence ; un test faux est écarté", async () => {
    prov.__setProviderForTests(fake);
    importPayload = {
      found: true,
      exercises: [
        {
          title: "Le double",
          statement: "Écrire une fonction double(n) qui renvoie le double du nombre n.",
          source: { quote: "ecrire une fonction double(n) qui renvoie le double du nombre n" },
          language: "javascript",
          referenceSolution: "function double(n){ return n * 2; }",
          tests: [
            { name: "positif", call: { fn: "double", args: [4] }, expected: 8 },
            { name: "zéro", call: { fn: "double", args: [0] }, expected: 0, edge: true },
            { name: "attendu FAUX", call: { fn: "double", args: [3] }, expected: 7 },
          ],
        },
        { title: "Inventé", statement: "Écrire une fonction quadruple(n) qui renvoie le quadruple.", source: { quote: "cette phrase n'existe nulle part dans le document" }, language: "javascript", referenceSolution: "function quadruple(n){ return n*4 }", tests: [] },
        {
          title: "Le triple, sans tests fiables",
          statement: "Écrire une fonction triple(n) qui renvoie le triple du nombre n.",
          source: { quote: "ecrire une fonction triple(n) qui renvoie le triple du nombre n" },
          language: "javascript",
          referenceSolution: "function triple(n){ return n * 3; }",
          tests: [{ name: "faux 1", call: { fn: "triple", args: [2] }, expected: 5 }],
        },
      ],
    };
    const r = await labs.createFromDocument(A, { documentId: docId, kind: "CODE", language: "javascript" });
    expect(r.workspaces).toHaveLength(2);
    const [double, triple] = r.workspaces;
    expect(double).toMatchObject({ title: "Le double", mode: "EXERCISE", subjectId: subj });
    expect(double.brief!.verified).toBe(true);
    expect(double.brief!.tests.map((t) => t.name)).toEqual(["positif", "zéro"]);
    expect(double.brief!.source).toMatchObject({ documentId: docId, documentName: "tp1" });
    expect(triple.brief!.verified).toBe(false);
    expect(r.notice).toMatch(/écartés/);
    expect(r.notice).toMatch(/sans tests automatiques/);
    expect(r.notice).toMatch(/incohérents/);
    // le document est transmis comme donnée non fiable
    expect(calls.at(-1)!.user).toMatch(/<DOC-[0-9a-f]+/);
    // les tests objectifs fonctionnent ; sans tests validés, ils sont refusés (pas de note inventée)
    const ok = await labs.runWorkspace(A, double.id, { mode: "tests", content: "function double(n){ return n + n; }" });
    expect(ok.tests!.summary.allPassed).toBe(true);
    await expect(labs.runWorkspace(A, triple.id, { mode: "tests", content: "function triple(n){ return n*3 }" })).rejects.toMatchObject({ status: 409 });
    const free = await labs.runWorkspace(A, triple.id, { mode: "run", content: "console.log('libre')" });
    expect(free.output).toMatchObject({ stdout: "libre\n" });
  }, 120_000);

  it("document d'autrui ou inexistant → 404", async () => {
    prov.__setProviderForTests(fake);
    await expect(labs.createFromDocument(B, { documentId: docId, kind: "CODE" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("isolation entre utilisateurs", () => {
  it("B ne voit, ne lance, ne modifie, ne supprime ni ne révèle rien de A", async () => {
    const w = await labs.createFree(A, { kind: "CODE", language: "javascript" });
    const ex = await labs.createFromQuestion(A, { exerciseId: exId, position: 1 });
    await expect(labs.getWorkspace(B, w.id)).rejects.toMatchObject({ status: 404 });
    await expect(labs.runWorkspace(B, w.id, { content: "console.log(1)" })).rejects.toMatchObject({ status: 404 });
    await expect(labs.updateWorkspace(B, w.id, { title: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(labs.deleteWorkspace(B, w.id)).rejects.toMatchObject({ status: 404 });
    await expect(labs.listRuns(B, w.id)).rejects.toMatchObject({ status: 404 });
    await expect(labs.hintFor(B, ex.id, {})).rejects.toMatchObject({ status: 404 });
    await expect(labs.revealSolution(B, ex.id)).rejects.toMatchObject({ status: 404 });
    await expect(labs.createFromQuestion(B, { exerciseId: exId, position: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(labs.createFree(B, { kind: "CODE", language: "python", subjectId: subj })).rejects.toMatchObject({ status: 404 });
    expect(await labs.listWorkspaces(B, {})).toEqual([]);
    expect((await labs.listWorkspaces(A, {})).length).toBeGreaterThan(0);
  }, 60_000);

  it("la suppression d'une matière ou d'un espace conserve la cohérence", async () => {
    const w = await labs.createFree(A, { kind: "SQL" });
    await labs.runWorkspace(A, w.id, { content: "SELECT 1;" });
    await labs.deleteWorkspace(A, w.id);
    expect(await db.labRun.count({ where: { workspaceId: w.id } })).toBe(0);
    expect(await db.learningActivity.count({ where: { refType: "lab", refId: w.id } })).toBe(0);
  }, 60_000);
});

describe("assistant IA des laboratoires", () => {
  const ask = async (user: string, id: string, emit?: (e: { type: "delta"; text: string }) => void) => {
    const { askLabAssistant, assistantSchema } = await import("./assistant");
    return askLabAssistant(user, id, assistantSchema.parse({ message: "Aide-moi", code: "print(1)" }), emit);
  };
  const reply = (text: string, seen: { system: string; turns: unknown[] }[]) => {
    prov.__setProviderForTests(fake);
    fake.converse = async (req) => {
      seen.push(req);
      if (req.onText) req.onText(text);
      return { text, calls: [], modelParts: [{ text }], model: "fake-model" };
    };
  };
  const exercise = () => db.labWorkspace.create({ data: { userId: A, kind: "CODE", mode: "EXERCISE", title: "Ex", files: [{ name: "a.py", language: "python", content: "" }], brief: { origin: "manual", statement: "Renvoyer 42", reference: "def secret_solution():\n    return 42\n", verified: false } } });

  it("espace libre : diffuse la réponse, voit le code et n'invente pas d'exécution", async () => {
    const seen: { system: string; turns: unknown[] }[] = [];
    reply("Voici une idée.", seen);
    const w = await labs.createFree(A, { kind: "CODE", language: "python" });
    const deltas: string[] = [];
    const r = await ask(A, w.id, (e) => deltas.push(e.text));
    expect(r).toEqual({ text: "Voici une idée.", guided: false });
    expect(deltas).toEqual(["Voici une idée."]);
    expect(seen[0].system).toContain("MODE LIBRE");
    expect(JSON.stringify(seen[0].turns)).toContain("print(1)");
    expect(JSON.stringify(seen[0].turns)).toContain("jamais été exécuté");
  });

  it("le même module sert au laboratoire SQL, avec son moteur", async () => {
    const seen: { system: string; turns: unknown[] }[] = [];
    reply("Regardez la jointure.", seen);
    const w = await labs.createFree(A, { kind: "SQL", fixtureId: "entreprise" });
    await ask(A, w.id);
    expect(seen[0].system).toContain("SQLite");
    expect(JSON.stringify(seen[0].turns)).toContain("Schéma et données");
  });

  it("exercice : ne transmet pas la solution au modèle et ne diffuse rien avant contrôle", async () => {
    const seen: { system: string; turns: unknown[] }[] = [];
    reply("Pensez à la valeur renvoyée.", seen);
    const w = await exercise();
    const deltas: string[] = [];
    const r = await ask(A, w.id, (e) => deltas.push(e.text));
    expect(r).toMatchObject({ guided: true, text: "Pensez à la valeur renvoyée." });
    expect(deltas).toEqual([]);
    expect(seen[0].system).toContain("MODE EXERCICE");
    expect(JSON.stringify(seen[0])).not.toContain("secret_solution");
  });

  it("exercice : une réponse contenant du code est remplacée", async () => {
    reply("```python\nprint(42)\n```", []);
    const w = await exercise();
    const r = await ask(A, w.id);
    expect(r.text).toContain("ne pas écrire la solution");
    expect(r.text).not.toContain("print(42)");
  });

  it("un autre étudiant n'y a pas accès", async () => {
    reply("x", []);
    const w = await exercise();
    await expect(ask(B, w.id)).rejects.toMatchObject({ status: 404 });
  });
});
