// Tests d'intégration de la progression : vraie base PGlite, vraies tentatives corrigées (types objectifs, sans IA).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

type Db = typeof import("@/lib/db").db;
let db: Db;
let att: typeof import("@/server/services/exercises/attempts");
let prog: typeof import("./progress");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string, subj: string, exId: string, cMain: string, cPre: string;

/** Passe une tentative : answers[i] = réponse à la question i+1 (vrai/faux, bonne réponse = true). */
async function attempt(answers: boolean[]) {
  const { id } = await att.startAttempt(A, exId, { fresh: true });
  for (let i = 0; i < answers.length; i++) await att.saveAnswer(A, id, i + 1, answers[i]);
  await att.submitAttempt(A, id);
  return id;
}

beforeAll(async () => {
  pg = await PGlite.create();
  for (const n of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261113000000_niala_google_link", "20261116000000_niala_profile_exercises", "20261117000000_niala_class_level_other", "20261118000000_niala_admin"]) {
    await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "migrations", n, "migration.sql"), "utf8"));
  }
  const port = 50000 + Math.floor(Math.random() * 4000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "sf-prog-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  process.env.GEMINI_API_KEY = ""; // vide (et non supprimé) : Prisma recharge .env sinon
  db = (await import("@/lib/db")).db;
  att = await import("@/server/services/exercises/attempts");
  prog = await import("./progress");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
  subj = (await db.subject.create({ data: { userId: A, name: "Algo" } })).id;
  cMain = (await db.concept.create({ data: { userId: A, subjectId: subj, name: "Récursivité", normalizedName: "recursivite", importance: 3 } })).id;
  cPre = (await db.concept.create({ data: { userId: A, subjectId: subj, name: "Fonction", normalizedName: "fonction", importance: 2 } })).id;
  await db.conceptRelation.create({ data: { userId: A, subjectId: subj, fromId: cPre, toId: cMain, type: "PREREQUISITE", origin: "USER" } });
  exId = (await db.exercise.create({ data: { userId: A, subjectId: subj, title: "Quiz", totalPoints: 4, config: {} } })).id;
  for (const [position, conceptId] of [[1, cMain], [2, cMain], [3, cPre], [4, cPre]] as const) {
    const q = await db.question.create({ data: { userId: A, exerciseId: exId, position, type: "true_false", points: 1, difficulty: "moyenne", payload: { statement: `Affirmation ${position}` }, answerKey: { answer: true }, sourceRefs: [] } });
    await db.questionConcept.create({ data: { questionId: q.id, conceptId } });
  }
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("maîtrise recalculée depuis les réponses corrigées", () => {
  it("une seule tentative : estimation prudente, aucune conclusion hâtive", async () => {
    await attempt([false, false, false, false]);
    const m = await db.conceptMastery.findUniqueOrThrow({ where: { conceptId: cMain } });
    expect(m.evidenceCount).toBe(2);
    expect(m.level).toBeLessThan(0.5);
    expect(m.confidence).toBeLessThan(0.35); // peu de preuves : « pas assez de données »
    const recs = await prog.listRecommendations(A);
    expect(recs.some((r) => r.type === "EXERCISE" && r.conceptId === cMain && /fragile/.test(r.text))).toBe(false);
    // notion principale : la suggestion est de la mesurer davantage, ou rien — jamais « fragile »
  }, 60_000);

  it("après plusieurs tentatives ratées : notion fragile, prérequis d'abord, avec preuves", async () => {
    await attempt([false, false, false, false]);
    await attempt([false, false, false, false]);
    const m = await db.conceptMastery.findUniqueOrThrow({ where: { conceptId: cMain } });
    expect(m.evidenceCount).toBe(6);
    expect(m.level).toBeLessThan(0.3);
    expect(m.confidence).toBeGreaterThanOrEqual(0.35);
    const recs = await prog.listRecommendations(A);
    // « Fonction » est un prérequis de « Récursivité » et est aussi fragile : on le consolide d'abord
    expect(recs[0]).toMatchObject({ type: "EXERCISE", conceptId: cPre, subjectId: subj });
    expect(recs[0].text).toMatch(/prérequis/);
    expect(recs[0].evidence).toMatchObject({ concept: "Fonction", blocks: "Récursivité" });
  }, 60_000);

  it("la maîtrise suit les progrès (résultats récents) ; recalcul idempotent", async () => {
    const before = (await db.conceptMastery.findUniqueOrThrow({ where: { conceptId: cMain } })).level;
    await attempt([true, true, true, true]);
    await attempt([true, true, true, true]);
    const after = await db.conceptMastery.findUniqueOrThrow({ where: { conceptId: cMain } });
    expect(after.level).toBeGreaterThan(before);
    const again = await prog.recomputeMastery(A);
    expect(again.concepts).toBe(2);
    expect((await db.conceptMastery.findUniqueOrThrow({ where: { conceptId: cMain } })).level).toBe(after.level);
  }, 60_000);

  it("les réponses non corrigées ne comptent pas comme preuve", async () => {
    const ex = await db.exercise.create({ data: { userId: A, subjectId: subj, title: "Ouvert", totalPoints: 2, config: {} } });
    const c = await db.concept.create({ data: { userId: A, subjectId: subj, name: "Autre", normalizedName: "autre" } });
    const q = await db.question.create({ data: { userId: A, exerciseId: ex.id, position: 1, type: "open", points: 2, difficulty: "moyenne", payload: { statement: "Expliquez." }, answerKey: { reference: "x", criteria: ["a", "b"] }, sourceRefs: [] } });
    await db.questionConcept.create({ data: { questionId: q.id, conceptId: c.id } });
    const { id } = await att.startAttempt(A, ex.id, { fresh: true });
    await att.saveAnswer(A, id, 1, "Une réponse longue");
    await att.submitAttempt(A, id); // pas d'IA : « non corrigée »
    expect(await db.conceptMastery.findUnique({ where: { conceptId: c.id } })).toBeNull();
  }, 60_000);
});

describe("tableau de bord et progression", () => {
  it("répond aux trois questions avec des données réelles", async () => {
    const d = await prog.dashboard(A, { date: "2026-11-09", minutes: 600 });
    expect(d.hasData).toBe(true);
    const s = d.subjects.find((x) => x.id === subj)!;
    expect(s).toMatchObject({ name: "Algo", exercises: 2 });
    expect(s.concepts.measured).toBe(2);
    expect(s.mastery).not.toBeNull();
    expect(d.recent.length).toBeGreaterThan(0);
    expect(d.recent[0].href).toMatch(/\/matieres\/.+\/exercices\/.+\/tentatives\//);
    expect(d.resume).toBeNull(); // toutes les tentatives sont terminées
  });

  it("reprise : une tentative en cours devient « prochaine activité »", async () => {
    const { id } = await att.startAttempt(A, exId, { fresh: true });
    const d = await prog.dashboard(A, { date: "2026-11-09", minutes: 600 });
    expect(d.resume).toMatchObject({ type: "EXERCISE", href: expect.stringContaining(id) });
  }, 60_000);

  it("détail d'une notion : preuves et mode de calcul", async () => {
    const c = await prog.conceptDetail(A, cMain);
    expect(c.evidence).toHaveLength(6 + 4);
    expect(c.mastery!.evidenceCount).toBe(10);
    expect(c.howItIsComputed).toMatch(/demi-vie/);
    const p = await prog.progress(A);
    expect(p.concepts.find((x) => x.id === cMain)!.prerequisites).toEqual([{ id: cPre, name: "Fonction" }]);
    expect(p.concepts.find((x) => x.id === cPre)).toBeDefined();
    expect(p.attempts.length).toBeGreaterThanOrEqual(5);
  });

  it("une recommandation écartée n'est pas réaffichée pendant 7 jours", async () => {
    await attempt([false, false, false, false]);
    await attempt([false, false, false, false]);
    const recs = await prog.listRecommendations(A);
    if (recs.length === 0) return;
    const first = recs[0];
    await prog.updateRecommendation(A, first.id, "DISMISSED");
    await prog.refreshRecommendations(A);
    expect((await prog.listRecommendations(A)).some((r) => r.conceptId === first.conceptId && r.type === first.type)).toBe(false);
  }, 60_000);
});

describe("derniers cours consultés", () => {
  let first: string, second: string, third: string, fourth: string;
  const opened = (id: string, at: string) => db.document.update({ where: { id }, data: { lastOpenedAt: new Date(at) } });
  const ranking = async () => (await prog.dashboard(A, { date: "2026-11-09", minutes: 600 })).recentDocuments.map((d) => d.id);

  beforeAll(async () => {
    const make = async (name: string) => (await db.document.create({ data: { userId: A, subjectId: subj, name, originalName: name, type: "pdf", size: 1, pageCount: 20 } })).id;
    [first, second, third, fourth] = await Promise.all(["Premier", "Deuxième", "Troisième", "Quatrième"].map(make));
  });

  it("n'invente aucun cours quand moins de trois ont été ouverts", async () => {
    await opened(first, "2026-11-01T08:00:00Z");
    expect(await ranking()).toEqual([first]);
  });

  it("classe sur la dernière consultation, jamais sur l'ordre de création", async () => {
    await opened(third, "2026-11-02T08:00:00Z");
    await opened(second, "2026-11-03T08:00:00Z");
    await opened(fourth, "2026-10-01T08:00:00Z");
    expect(await ranking()).toEqual([second, third, first]);
  });

  it("une nouvelle ouverture fait remonter le document, sans doublon", async () => {
    const { recordOpening } = await import("@/server/services/documents");
    await recordOpening(A, fourth);
    await recordOpening(A, fourth);
    expect(await ranking()).toEqual([fourth, second, third]);
  });

  it("la reprise vise la dernière page enregistrée, et la lecture met à jour le classement", async () => {
    const { recordReading } = await import("@/server/services/documents");
    await recordReading(A, first, 7);
    const d = await prog.dashboard(A, { date: "2026-11-09", minutes: 600 });
    expect(d.recentDocuments[0]).toMatchObject({ id: first, lastPage: 7, pageCount: 20, href: `/matieres/${subj}/documents/${first}?page=7` });
  });

  it("le document d'un autre étudiant ne peut pas être marqué comme ouvert", async () => {
    const { recordOpening } = await import("@/server/services/documents");
    await expect(recordOpening(B, first)).rejects.toMatchObject({ status: 404 });
  });
});

describe("cours présentés par le tableau de bord", () => {
  it("couvre la bascule du soir et distingue un agenda vide", async () => {
    expect((await prog.dashboard(B, { date: "2026-11-09", minutes: 600 })).schedule).toBe("empty");
    const s = await db.subject.create({ data: { userId: B, name: "Réseaux", color: "#112233", icon: "network" } });
    await db.scheduleEvent.create({ data: { userId: B, subjectId: s.id, title: "Réseaux", date: "2026-11-10", startMinutes: 480, endMinutes: 600, teacher: "M. Test" } });
    const d = await prog.dashboard(B, { date: "2026-11-09", minutes: 19 * 60 });
    expect(d.schedule).toBe("ok");
    const { buildDayView } = await import("@/server/domain/dashboard");
    const evening = buildDayView({ date: "2026-11-09", nowMinutes: 19 * 60, courses: d.today, schedule: d.schedule });
    expect(evening.courses[0]).toMatchObject({ title: "Réseaux", teacher: "M. Test", subjectColor: "#112233", subjectIcon: "network", phase: "upcoming" });
    const afternoon = buildDayView({ date: "2026-11-09", nowMinutes: 18 * 60 + 59, courses: d.today, schedule: d.schedule });
    expect(afternoon.state).toBe("none");
    expect(afternoon.next?.date).toBe("2026-11-10");
    await db.scheduleEvent.deleteMany({ where: { userId: B } });
    await db.subject.delete({ where: { id: s.id } });
  });
});

describe("isolation entre utilisateurs", () => {
  it("B ne voit rien de A", async () => {
    const d = await prog.dashboard(B, { date: "2026-11-09", minutes: 600 });
    expect(d).toMatchObject({ hasData: false, subjects: [], recent: [], next: null, resume: null });
    expect((await prog.progress(B)).concepts).toEqual([]);
    await expect(prog.conceptDetail(B, cMain)).rejects.toMatchObject({ status: 404 });
    await expect(prog.progress(B, subj)).rejects.toMatchObject({ status: 404 });
    const rec = await db.learningRecommendation.findFirst({ where: { userId: A } });
    if (rec) await expect(prog.updateRecommendation(B, rec.id, "DONE")).rejects.toMatchObject({ status: 404 });
    expect(await prog.listRecommendations(B)).toEqual([]);
  });
});
