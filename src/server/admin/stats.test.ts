// Statistiques du back-office sur une vraie base PGlite : données mesurées, évolutions, rétention, carte de chaleur,
// seuils d'anonymat et absence de données inventées.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let common: typeof import("@/server/admin/stats/common");
let overview: typeof import("@/server/admin/stats/overview");
let usage: typeof import("@/server/admin/stats/usage");
let features: typeof import("@/server/admin/stats/features");
let pedagogy: typeof import("@/server/admin/stats/pedagogy");
let tech: typeof import("@/server/admin/stats/tech");
let ai: typeof import("@/server/admin/stats/ai");
let track: typeof import("@/server/analytics/track");

const DAY = 86_400_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * DAY - hours * 3_600_000);
const ids: string[] = [];
/** Le moteur Prisma date les lignes avec sa propre horloge (écart de quelques ms avec celle de Node, surtout sous Windows). */
const settle = () => new Promise((r) => setTimeout(r, 80));

beforeAll(async () => {
  ctx = await startTestDb();
  common = await import("@/server/admin/stats/common");
  overview = await import("@/server/admin/stats/overview");
  usage = await import("@/server/admin/stats/usage");
  features = await import("@/server/admin/stats/features");
  pedagogy = await import("@/server/admin/stats/pedagogy");
  tech = await import("@/server/admin/stats/tech");
  ai = await import("@/server/admin/stats/ai");
  track = await import("@/server/analytics/track");
}, 120_000);

afterAll(async () => {
  await ctx?.stop();
});

async function makeUser(name: string, category: string, createdDaysAgo: number) {
  const u = await ctx.db.user.create({ data: { email: `${name}@test.fr`, name, passwordHash: "x", createdAt: ago(createdDaysAgo), profile: { create: { category, institution: category === "ESATIC" ? "ESATIC" : "Autre", level: "L3", field: "Informatique" } } } });
  ids.push(u.id);
  return u;
}

describe("période", () => {
  it("compare à la période précédente de même durée, sans jamais inventer d'évolution", () => {
    const now = new Date("2026-11-10T15:00:00Z");
    const p = common.resolvePeriod({ p: "7d" }, now);
    expect(p.to).toEqual(now);
    expect(p.from.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(p.prevTo.getTime()).toBe(p.to.getTime() - 7 * DAY);
    expect(common.resolvePeriod({ p: "today" }, now).bucket).toBe("hour");
    expect(common.resolvePeriod({ p: "12m" }, now).bucket).toBe("month");
    expect(common.resolvePeriod({ p: "custom", from: "2026-10-01", to: "2026-10-10" }, now).label).toContain("2026-10-01");
    expect(common.resolvePeriod({ p: "n'importe quoi" }, now).key).toBe("30d");
    expect(common.metric(10, 0).change).toBeNull();
    expect(common.metric(12, 10).change).toBe(20);
    expect(common.metric(5, null).change).toBeNull();
  });
});

describe("collecte et vue d'ensemble", () => {
  it("n'affiche aucune évolution tant que l'historique manque, puis compte activité, sessions et rétention", async () => {
    const a = await makeUser("ada", "ESATIC", 40);
    const b = await makeUser("bob", "OTHER_SCHOOL", 40);
    const c = await makeUser("cleo", "TESTER", 20);
    const d = await makeUser("dan", "ESATIC", 2);

    const empty = await overview.getOverview(common.resolvePeriod({ p: "30d" }));
    expect(empty.coverage.liveSince).toBeNull();
    expect(empty.kpis.users.find((k) => k.key === "active-30d")?.value).toBe(0);
    expect(empty.kpis.users.find((k) => k.key === "active-30d")?.change).toBeNull();
    expect(empty.insights.join(" ")).toContain("Aucun événement");

    // Ada : deux sessions séparées de plus de 30 min le même jour, puis revient le lendemain (J1 depuis hier…)
    const at = (u: { id: string }, type: Parameters<typeof track.recordEvent>[1], when: Date, opts: Parameters<typeof track.recordEvent>[2] = {}) => track.recordEvent(u.id, type, { at: when, ...opts });
    await at(a, "auth.login", ago(1, 5));
    await at(a, "module.open", ago(1, 5) , { module: "exercises" });
    await at(a, "exercise.generate", new Date(ago(1, 5).getTime() + 10 * 60_000), { module: "exercises" });
    await at(a, "module.open", ago(1, 2), { module: "assistant" });
    await at(a, "assistant.message", new Date(ago(1, 2).getTime() + 5 * 60_000), { module: "assistant", durationMs: 1200 });
    const justNow = new Date(Date.now() - 60_000);
    await at(b, "module.open", justNow, { module: "sql" });
    await at(b, "lab.run", justNow, { module: "sql", ok: false });
    await at(c, "auth.login", ago(0, 3));
    await at(d, "account.register", ago(2)); // jalon non significatif

    await settle();
    const p = common.resolvePeriod({ p: "7d" });
    const o = await overview.getOverview(p);
    expect(o.coverage.liveEvents).toBeGreaterThan(0);
    const k = (key: string) => o.kpis.users.find((x) => x.key === key)!;
    expect(k("total").value).toBe(4);
    expect(k("new").value).toBe(1); // dan
    expect(k("active-7d").value).toBe(2); // ada + bob ; cleo (connexion seule) et dan (inscription) ne comptent pas
    expect(k("active-today").value).toBe(1); // bob
    expect(k("active-30d").change).toBeNull(); // la collecte est trop récente pour comparer à la période d'avant

    const sessions = o.kpis.usage.find((x) => x.key === "sessions")!;
    expect(sessions.value).toBe(5); // ada ×2 (écart > 30 min), bob, cleo (connexion seule) et dan (inscription) ×1 chacun
    const duration = o.kpis.usage.find((x) => x.key === "session-duration")!;
    expect(duration.value).not.toBeNull();
    expect(o.series.registrations.reduce((s, x) => s + x.value, 0)).toBe(1);
    expect(o.categories.reduce((s, x) => s + x.value, 0)).toBe(4);
  });

  it("calcule la rétention par cohorte sans compter les comptes trop récents", async () => {
    const r = await usage.getRetention();
    expect(r.overall.eligible.d7).toBeGreaterThan(0);
    const dan = r.cohorts.reduce((s, c) => s + c.size, 0);
    expect(dan).toBe(4);
    // dan s'est inscrit il y a 2 jours : ni J7 ni J30 ne sont calculables pour lui
    const j30 = r.overall.eligible.d30;
    expect(j30).toBeLessThan(4);
    expect(r.liveSince).not.toBeNull();
  });
});

describe("carte de chaleur", () => {
  it("ne tire de conclusion que si l'échantillon la justifie", async () => {
    const p = common.resolvePeriod({ p: "7d" });
    const h = await usage.getHeatmap(p, "events");
    expect(h.cells).toHaveLength(7);
    expect(h.cells[0]).toHaveLength(24);
    expect(h.insights).toEqual([]); // peu d'événements : pas de phrase du type « actifs entre 18 h et 22 h »

    const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (let d = 0; d < 7; d++) for (let hour = 18; hour < 22; hour++) cells[d][hour] = 20;
    const text = usage.heatmapInsights(cells, 560, 12).join(" ");
    expect(text).toContain("entre 18 h et 22 h");
    expect(usage.heatmapInsights(cells, 10, 12)).toEqual([]);
    expect(usage.heatmapInsights(cells, 560, 2)).toEqual([]);
  });
});

describe("fonctionnalités et pédagogie", () => {
  it("mesure adoption, abandon et échecs à partir des tables réelles", async () => {
    const [ada, bob] = await ctx.db.user.findMany({ where: { name: { in: ["ada", "bob"] } }, orderBy: { name: "asc" } });
    const subject = await ctx.db.subject.create({ data: { userId: ada.id, name: "Algorithmique" } });
    const ex = await ctx.db.exercise.create({ data: { userId: ada.id, subjectId: subject.id, title: "Tri", config: {}, totalPoints: 10, origin: "DOCUMENT" } });
    const mk = (userId: string, status: "GRADED" | "IN_PROGRESS", score: number | null, startedDaysAgo: number, updatedDaysAgo = startedDaysAgo) =>
      ctx.db.exerciseAttempt.create({ data: { userId, exerciseId: ex.id, snapshot: {}, status, score, maxScore: 10, startedAt: ago(startedDaysAgo), finishedAt: status === "GRADED" ? ago(startedDaysAgo) : null, updatedAt: ago(updatedDaysAgo) } });
    await mk(ada.id, "GRADED", 8, 1);
    await mk(ada.id, "GRADED", 3, 2);
    await mk(bob.id, "IN_PROGRESS", null, 20); // abandonnée : inactive depuis plus de 7 jours
    await mk(bob.id, "IN_PROGRESS", null, 0); // en cours : ni terminée ni abandonnée

    const p = common.resolvePeriod({ p: "30d" });
    const out = await features.attemptOutcomes(p.from, p.to);
    expect(out).toMatchObject({ started: 4, completed: 2, abandoned: 1, running: 1 });
    expect(out.rate).toBeCloseTo(33.3, 1);

    const f = await features.getFeatureReport(p);
    const solving = f.features.find((x) => x.key === "exercise-generation")!;
    expect(solving.uniqueUsers.value).toBe(1);
    expect(f.features.every((x) => x.adoption == null || x.adoption <= 100)).toBe(true);

    // Suggestions de révision : affichées / suivies / écartées, lues dans la table d'origine
    await ctx.db.learningRecommendation.createMany({ data: (["SUGGESTED", "DONE", "DISMISSED", "IN_PROGRESS"] as const).map((status) => ({ userId: ada.id, activityType: "REVIEW", reason: {}, status })) });
    await settle();
    const withReco = await features.getFeatureReport(common.resolvePeriod({ p: "30d" }));
    expect(withReco.recommendations).toMatchObject({ shown: 4, followed: 2, dismissed: 1, pending: 1, followRate: 50 });

    const ped = await pedagogy.getPedagogy(p);
    expect(ped.exercises.completed.value).toBe(2);
    expect(ped.exercises.successRate.value).toBe(50); // 8/10 réussi, 3/10 échoué
    // Une seule matière / un seul étudiant : sous le seuil d'anonymat, rien n'est nommé
    expect(ped.subjects.ranking).toEqual([]);
    expect(ped.subjects.hiddenSubjects).toBeGreaterThan(0);
    expect(ped.environments.map((e) => e.key)).toEqual(["CODE", "SQL"]);
  });
});

describe("technique et IA", () => {
  it("classe les erreurs et ouvre puis résout les alertes", async () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, i) => ({ route: "/api/subjects", method: "GET", status: 200, durationMs: 80 + i, module: "subjects" })),
      ...Array.from({ length: 6 }, () => ({ route: "/api/files/:id/text", method: "GET", status: 500, durationMs: 300, module: "documents", errorKind: "APP", errorSummary: "Error" })),
      { route: "/api/exercises", method: "POST", status: 503, durationMs: 900, module: "exercises", errorKind: "EXTERNAL" },
      { route: "/api/subjects", method: "POST", status: 422, durationMs: 20, module: "subjects", errorKind: "USER" },
    ];
    await ctx.db.requestLog.createMany({ data: rows });
    await settle();
    const p = common.resolvePeriod({ p: "today" });
    const t = await tech.getTechReport(p);
    expect(t.requests).toBe(48);
    expect(t.serverErrors).toBe(7);
    expect(t.byKind).toEqual({ USER: 1, APP: 6, EXTERNAL: 1 });
    expect(t.availability).toBeCloseTo(85.4, 1);
    expect((await tech.getTechReport(p, "documents")).requests).toBe(6);
    expect(t.frequentErrors[0]).toMatchObject({ route: "/api/files/:id/text", status: 500, count: 6 });

    await tech.evaluateAlerts(true);
    const open = await ctx.db.adminAlert.findMany({ where: { status: "OPEN" } });
    expect(open.map((a) => a.key)).toContain("errors.rate");

    await ctx.db.requestLog.deleteMany({});
    await tech.evaluateAlerts(true);
    expect(await ctx.db.adminAlert.count({ where: { key: "errors.rate", status: "OPEN" } })).toBe(0);
    expect(await ctx.db.adminAlert.count({ where: { key: "errors.rate", status: "RESOLVED" } })).toBe(1);
  });

  it("agrège les appels IA sans jamais fabriquer de jetons ni de coût", async () => {
    const [ada] = await ctx.db.user.findMany({ where: { name: "ada" } });
    await ctx.db.aIUsageLog.createMany({
      data: [
        { userId: ada.id, op: "exercise.generate@1", model: "gemini-x", promptChars: 1000, respChars: 3000, ok: true, durationMs: 4000 },
        { userId: ada.id, op: "exercise.generate@1", model: "gemini-x", promptChars: 1000, respChars: 0, ok: false, error: "timeout", durationMs: 9000 },
        { userId: ada.id, op: "analysis.concepts@2", model: "gemini-x", promptChars: 5000, respChars: 800, ok: true, durationMs: 2000 },
        { userId: ada.id, op: "chat.turn@1", model: "gemini-y", promptChars: 300, respChars: 600, ok: true, durationMs: 1000 },
      ],
    });
    await settle();
    const r = await ai.getAiReport(common.resolvePeriod({ p: "today" }));
    expect(r.calls.value).toBe(4);
    expect(r.failed).toBe(1);
    expect(r.failureRate).toBe(25);
    expect(r.generations).toBe(2);
    expect(r.documentAnalyses).toBe(1);
    expect(r.assistances).toBe(1);
    expect(r.byModel.map((m) => m.model)).toEqual(["gemini-x", "gemini-y"]);
    expect(r.chars.prompt).toBe(7300);
    expect(JSON.stringify(r)).not.toMatch(/apiKey|secret/i);
    expect(r.unavailable.join(" ")).toContain("jetons");
  });
});
