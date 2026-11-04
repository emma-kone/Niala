// Intégration : analyse en direct et diagnostic unifié, avec la vraie exécution isolée (QuickJS, Pyodide, sql.js)
// et une vraie base PGlite (migrations réelles). Aucun fournisseur IA : tout est établi par les outils.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

let db: typeof import("@/lib/db").db;
let labs: typeof import("./labs");
let analyze: typeof import("./analyze");
let progress: typeof import("@/server/services/progress/progress");
let profile: typeof import("@/server/services/progress/profile");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string;
let B: string;

const MIGRATIONS = ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261105000000_niala_diagnosis", "20261106000000_niala_progression", "20261107000000_niala_followups"];

beforeAll(async () => {
  pg = await PGlite.create();
  for (const n of MIGRATIONS) await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "migrations", n, "migration.sql"), "utf8"));
  const port = 50000 + Math.floor(Math.random() * 9000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-diag-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  process.env.GEMINI_API_KEY = "";
  db = (await import("@/lib/db")).db;
  labs = await import("./labs");
  analyze = await import("./analyze");
  progress = await import("@/server/services/progress/progress");
  profile = await import("@/server/services/progress/profile");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
}, 90_000);

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("analyse en direct (le code n'est jamais exécuté)", () => {
  it("JavaScript / TypeScript : erreur de syntaxe située à la ligne, avec explication ; code valide accepté", async () => {
    const bad = await analyze.analyzeCode(A, { language: "javascript", content: "const a = 1;\nconsole.log(a" });
    expect(bad).toMatchObject({ executable: true, verification: "compiler", summary: "syntax_error" });
    expect(bad.problems[0]).toMatchObject({ line: 2, severity: "error", kind: "syntax", source: "sucrase" });
    expect(bad.problems[0].hint).toBeTruthy();
    expect(await analyze.analyzeCode(A, { language: "javascript", content: "const a = 1;\nconsole.log(a);" })).toMatchObject({ summary: "ok", problems: [] });
    expect((await analyze.analyzeCode(A, { language: "typescript", content: "const x: number = ;" })).problems[0]).toMatchObject({ line: 1, kind: "syntax" });
    expect(await analyze.analyzeCode(A, { language: "typescript", content: "const x: number = 3;" })).toMatchObject({ summary: "ok" });
  });

  it("une boucle infinie n'est PAS exécutée par l'analyse", async () => {
    const r = await analyze.analyzeCode(A, { language: "javascript", content: "while (true) {}" });
    expect(r.summary).toBe("ok");
    expect(r.durationMs).toBeLessThan(2000);
  });

  it("Python : compile() dans le runner isolé, sans exécuter le code", async () => {
    const bad = await analyze.analyzeCode(A, { language: "python", content: "x = 1\nif x == 1\n    print(x)\n" });
    expect(bad.summary).toBe("syntax_error");
    expect(bad.problems[0]).toMatchObject({ line: 2, source: "python", kind: "syntax" });
    expect(bad.problems[0].hint).toContain("deux-points");
    const ok = await analyze.analyzeCode(A, { language: "python", content: "import os\nos.remove('x')\nprint(1)\n" });
    expect(ok).toMatchObject({ summary: "ok", problems: [], verification: "compiler" });
  }, 60_000);

  it("SQL : EXPLAIN sur le schéma de l'espace, agrégat dans WHERE expliqué ; schéma d'un autre utilisateur inaccessible", async () => {
    const w = await labs.createFree(A, { kind: "SQL", fixtureId: "entreprise" });
    const bad = await analyze.analyzeCode(A, { language: "sql", content: "SELECT service_id, COUNT(*) FROM employes\nWHERE COUNT(*) > 1 GROUP BY service_id;", workspaceId: w.id });
    expect(bad.summary).toBe("syntax_error");
    expect(bad.problems[0].message).toMatch(/misuse of aggregate/i);
    expect(bad.problems[0].hint).toContain("HAVING");
    const col = await analyze.analyzeCode(A, { language: "sql", content: "SELECT prenom FROM employes;", workspaceId: w.id });
    expect(col.problems[0].hint).toContain("colonne");
    expect(await analyze.analyzeCode(A, { language: "sql", content: "SELECT nom FROM employes ORDER BY salaire DESC;", workspaceId: w.id })).toMatchObject({ summary: "ok", problems: [] });
    await expect(analyze.analyzeCode(B, { language: "sql", content: "SELECT 1", workspaceId: w.id })).rejects.toMatchObject({ status: 404 });
  }, 60_000);

  it("C et C# : non exécutables, délimiteurs vérifiés seulement et annoncé comme tel", async () => {
    const r = await analyze.analyzeCode(A, { language: "c", content: 'int main(void) {\n  printf("a");\n' });
    expect(r).toMatchObject({ executable: false, verification: "form", summary: "not_executable" });
    expect(r.executableReason).toContain("pas exécutable");
    expect(r.problems[0]).toMatchObject({ line: 1, kind: "structure", source: "brackets" });
    expect((await analyze.analyzeCode(A, { language: "csharp", content: "class P { void M() { } }" })).problems).toEqual([]);
    expect(await analyze.analyzeCode(A, { language: "javascript", content: "   " })).toMatchObject({ summary: "empty" });
  });
});

describe("diagnostic unifié des exécutions", () => {
  it("syntaxe : fait établi par l'outil, jamais un doute sur la compréhension", async () => {
    const w = await labs.createFree(A, { kind: "CODE", language: "javascript" });
    const r = await labs.runWorkspace(A, w.id, { mode: "run", content: "let = ;" });
    expect(r.report).toMatchObject({ primary: "SYNTAX", state: "DETERMINED", needsVerification: false, pedagogical: true });
    expect(r.report!.confidence).toBeGreaterThan(0.9);
    const row = await db.diagnosisReport.findFirstOrThrow({ where: { labRunId: r.id } });
    expect(row).toMatchObject({ activity: "CODE", primary: "SYNTAX", source: "tools", engineVersion: "1" });
  });

  it("une exécution libre sans erreur ne produit aucun diagnostic", async () => {
    const w = await labs.createFree(A, { kind: "CODE", language: "javascript" });
    const r = await labs.runWorkspace(A, w.id, { mode: "run", content: "console.log(1 + 1)" });
    expect(r.report).toBeNull();
  });

  it("même erreur répétée : récurrence constatée, piste conceptuelle seulement à vérifier", async () => {
    const w = await labs.createFree(A, { kind: "CODE", language: "javascript" });
    const reports: NonNullable<Awaited<ReturnType<typeof labs.runWorkspace>>["report"]>[] = [];
    for (let i = 0; i < 3; i++) reports.push((await labs.runWorkspace(A, w.id, { mode: "run", content: `const o = null;\nconsole.log(o.x + ${i});` })).report!);
    expect(reports[0]).toMatchObject({ primary: "LOGIC", needsVerification: false });
    expect(reports[2].evidence.join(" ")).toContain("2 tentative(s) précédente(s)");
    expect(reports[2]).toMatchObject({ needsVerification: true, recommendedAction: "clarifying_question", severity: "high" });
  });

  it("SQL : confusion WHERE / HAVING signalée comme hypothèse à vérifier, avec le message réel du moteur", async () => {
    const w = await labs.createFree(A, { kind: "SQL", fixtureId: "entreprise" });
    const r = await labs.runWorkspace(A, w.id, { content: "SELECT service_id, COUNT(*) FROM employes WHERE COUNT(*) > 1 GROUP BY service_id;" });
    expect(r.report).toMatchObject({ primary: "CONCEPT", needsVerification: true, recommendedAction: "clarifying_question" });
    expect(r.report!.confidence).toBeLessThan(0.8);
    expect(r.report!.summary).toContain("HAVING");
    expect(r.report!.evidence.join(" ")).toMatch(/misuse of aggregate/i);
  });

  it("SQL valide mais comparaison à NULL : erreur de logique détectée sans message d'erreur", async () => {
    const w = await labs.createFree(A, { kind: "SQL", fixtureId: "entreprise" });
    const r = await labs.runWorkspace(A, w.id, { content: "SELECT nom FROM employes WHERE nom = NULL;" });
    expect(r.report).toMatchObject({ primary: "LOGIC", state: "DETERMINED" });
    expect(r.report!.summary).toContain("IS NULL");
  });

  it("Python : bibliothèque absente = problème d'environnement, pas une lacune", async () => {
    const w = await labs.createFree(A, { kind: "CODE", language: "python" });
    const r = await labs.runWorkspace(A, w.id, { content: "import module_qui_n_existe_pas_xyz\nprint(1)" });
    expect(r.report).toMatchObject({ primary: "ENVIRONMENT", pedagogical: false, recommendedAction: "check_environment" });
  }, 60_000);
});

describe("observations par compétence", () => {
  it("les constats des outils alimentent des compétences communes aux langages ; une réussite ou un environnement défaillant n'en crée aucune", async () => {
    const js = await labs.createFree(A, { kind: "CODE", language: "javascript" });
    const sql = await labs.createFree(A, { kind: "SQL", fixtureId: "entreprise" });
    const before = await db.skillObservation.count({ where: { userId: A, skill: "syntaxe" } });
    await labs.runWorkspace(A, js.id, { mode: "run", content: "let = ;" });
    await labs.runWorkspace(A, sql.id, { content: "SELEC nom FROM employes;" });
    const rows = await db.skillObservation.findMany({ where: { userId: A, skill: "syntaxe" }, orderBy: { createdAt: "asc" } });
    expect(rows.length - before).toBe(2);
    expect(rows.slice(-2).map((r) => [r.activity, r.language])).toEqual([["CODE", "javascript"], ["SQL", "sql"]]);
    const nulls = await db.skillObservation.count({ where: { userId: A, skill: "valeurs-nulles" } });
    await labs.runWorkspace(A, sql.id, { content: "SELECT nom FROM employes WHERE nom = NULL;" });
    expect(await db.skillObservation.count({ where: { userId: A, skill: "valeurs-nulles" } })).toBe(nulls + 1);
    // une exécution sans erreur ne crée aucune observation
    const total = await db.skillObservation.count({ where: { userId: A } });
    await labs.runWorkspace(A, js.id, { mode: "run", content: "console.log(2)" });
    expect(await db.skillObservation.count({ where: { userId: A } })).toBe(total);
  });
});

describe("profil pédagogique et recommandations adaptées", () => {
  it("une difficulté de raisonnement répétée sur plusieurs jours devient une recommandation justifiée ; la syntaxe seule n'en produit pas", async () => {
    const subject = await db.subject.create({ data: { userId: A, name: "Algo profil" } });
    const mk = async (skill: string, language: string, days: number) => {
      const rep = await db.diagnosisReport.create({ data: { userId: A, activity: "CODE", subjectId: subject.id, language, primary: "LOGIC", secondary: [], state: "DETERMINED", summary: "x", evidence: ["e"], concepts: [], prerequisites: [], severity: "medium", confidence: 0.8, recommendedAction: "retry", source: "tools", engineVersion: "1" } });
      await db.skillObservation.create({ data: { userId: A, skill, activity: "CODE", language, reportId: rep.id, category: "LOGIC", createdAt: new Date(Date.now() - days * 24 * 3600 * 1000) } });
    };
    for (const [d, lang] of [[6, "python"], [3, "javascript"], [1, "python"]] as const) await mk("cas-limites", lang, d);
    for (const d of [5, 3, 1, 0]) await mk("syntaxe", "python", d);
    await progress.refreshRecommendations(A);
    const recs = await progress.listRecommendations(A, subject.id);
    const adaptive = recs.filter((r) => (r.evidence as { adaptation?: string }).adaptation);
    expect(adaptive.map((r) => (r.evidence as { skill?: string }).skill)).toEqual(["cas-limites"]);
    expect(adaptive[0]).toMatchObject({ type: "LAB", subjectId: subject.id });
    expect(adaptive[0].text).toContain("la syntaxe n'est pas en cause");
    const p = await profile.learningProfile(A, subject.id);
    expect(p.hasData).toBe(true);
    expect(p.recurring.map((r) => r.skill).sort()).toEqual(["cas-limites", "syntaxe"]);
    expect(p.recurring.find((r) => r.skill === "cas-limites")!.statement).toContain("À vérifier");
    expect(p.recent.length).toBeGreaterThan(0);
    await expect(profile.learningProfile(B, subject.id)).rejects.toMatchObject({ status: 404 });
    expect((await profile.learningProfile(B)).hasData).toBe(false);
    expect(profile.profileForPrompt(p)).toContain("hypothèses à vérifier");
  });
});

