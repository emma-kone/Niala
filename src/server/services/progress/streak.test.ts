// Tests d'intégration de la série de jours : vraie base PGlite avec toutes les migrations.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

type Db = typeof import("@/lib/db").db;
let stop: () => Promise<void>;
let db: Db;
let svc: typeof import("./streak");
let docs: typeof import("@/server/services/documents");
let A: string, B: string;

const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const t = await startTestDb();
  db = t.db as Db;
  stop = t.stop;
  svc = await import("./streak");
  docs = await import("@/server/services/documents");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
}, 60_000);
afterAll(async () => stop?.());

describe("service de série", () => {
  it("enregistre un jour une seule fois, même après plusieurs activités", async () => {
    await svc.recordActivity(A, "2026-03-09");
    await svc.recordActivity(A, "2026-03-09");
    svc.resetStreakCache();
    await svc.recordActivity(A, "2026-03-09"); // la mémoire est vidée : la base elle-même refuse le doublon
    expect(await db.activityDay.count({ where: { userId: A, day: "2026-03-09" } })).toBe(1);
  });

  it("calcule série, record et état du jour", async () => {
    for (const d of ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-08", "2026-03-10"]) await svc.recordActivity(A, d);
    const s = await svc.getStreak(A, "2026-03-10");
    expect(s).toMatchObject({ current: 3, longest: 4, doneToday: true, atRisk: false });
    expect(s.message).toMatch(/3 jours/);
    expect((await svc.getStreak(A, "2026-03-11")).atRisk).toBe(true);
    expect((await svc.getStreak(A, "2026-03-14")).current).toBe(0);
  });

  it("isole les étudiants", async () => {
    expect((await svc.getStreak(B, "2026-03-10")).totalDays).toBe(0);
  });

  it("une activité réelle (ouverture d'un cours) enregistre le jour sans attendre", async () => {
    const subject = await db.subject.create({ data: { userId: B, name: "Algo" } });
    const doc = await db.document.create({ data: { userId: B, subjectId: subject.id, name: "Cours", originalName: "cours.pdf", type: "pdf", size: 1 } as never });
    const t0 = Date.now();
    await docs.recordOpening(B, doc.id);
    const returnedIn = Date.now() - t0;
    await wait();
    const today = new Date().toISOString().slice(0, 10);
    expect(await db.activityDay.count({ where: { userId: B, day: today } })).toBe(1);
    expect(returnedIn).toBeLessThan(2000);
    expect((await svc.getStreak(B, today)).current).toBe(1);
  });

  it("une erreur d'écriture est avalée et ne fait pas échouer l'action", async () => {
    await expect(svc.recordActivity("utilisateur-inexistant", "2026-03-10")).resolves.toBeUndefined();
  });
});
