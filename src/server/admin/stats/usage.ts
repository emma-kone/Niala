import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CATEGORIES, type CategoryKey } from "@/server/analytics/definitions";
import { activeTypesSql, cached, coverage, ensureActorKeys, n, periodKey, ratio, round1, sessionsCte, startOfDay, truncate, type Period } from "@/server/admin/stats/common";

// Habitudes d'utilisation : carte de chaleur, tendances, comparaison des catégories, fidélisation par cohortes.

const DAY = 86_400_000;
export const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

// ── Carte de chaleur ─────────────────────────────────────────────────────────
export type HeatMetric = "users" | "events";
export interface Heatmap {
  metric: HeatMetric;
  /** cells[jour 0=lundi][heure 0-23] */
  cells: number[][];
  max: number;
  total: number;
  users: number;
  hourTotals: number[];
  dayTotals: number[];
  insights: string[];
}

export function getHeatmap(period: Period, metric: HeatMetric, category?: string): Promise<Heatmap> {
  return cached(`heat:${periodKey(period)}:${metric}:${category ?? ""}`, () => computeHeatmap(period, metric, category));
}

async function computeHeatmap(p: Period, metric: HeatMetric, category?: string): Promise<Heatmap> {
  const cat = category && category !== "ALL" ? (category === "NONE" ? Prisma.sql`AND category IS NULL` : Prisma.sql`AND category = ${category}`) : Prisma.empty;
  const rows = await db.$queryRaw<{ dow: number; hour: number; value: bigint }[]>`
    SELECT extract(isodow FROM "createdAt")::int AS dow, extract(hour FROM "createdAt")::int AS hour,
           ${metric === "users" ? Prisma.sql`count(DISTINCT "actorKey")` : Prisma.sql`count(*)`} AS value
    FROM "AnalyticsEvent"
    WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} ${cat}
    GROUP BY 1, 2`;
  const usersRow = await db.$queryRaw<{ users: bigint; events: bigint }[]>`
    SELECT count(DISTINCT "actorKey") AS users, count(*) AS events FROM "AnalyticsEvent"
    WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} ${cat}`;
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) cells[r.dow - 1][r.hour] = n(r.value);
  const hourTotals = Array.from({ length: 24 }, (_, h) => cells.reduce((s, d) => s + d[h], 0));
  const dayTotals = cells.map((d) => d.reduce((s, v) => s + v, 0));
  const users = n(usersRow[0]?.users);
  const events = n(usersRow[0]?.events);
  return { metric, cells, max: Math.max(0, ...cells.flat()), total: metric === "events" ? events : hourTotals.reduce((a, b) => a + b, 0), users, hourTotals, dayTotals, insights: heatmapInsights(cells, events, users) };
}

/** Conclusions rédigées seulement quand l'échantillon et l'écart à une répartition uniforme les justifient. */
export function heatmapInsights(cells: number[][], events: number, users: number): string[] {
  const MIN_EVENTS = 30;
  const MIN_USERS = 3;
  if (events < MIN_EVENTS || users < MIN_USERS) return [];
  // On raisonne sur le nombre d'événements par heure (et non sur les utilisateurs distincts qui ne s'additionnent pas).
  const hourly = Array.from({ length: 24 }, (_, h) => cells.reduce((s, d) => s + d[h], 0));
  const daily = cells.map((d) => d.reduce((s, v) => s + v, 0));
  const sum = hourly.reduce((a, b) => a + b, 0);
  if (!sum) return [];
  const out: string[] = [];
  let best = { start: 0, share: 0 };
  for (let s = 0; s < 24; s++) {
    const w = [0, 1, 2, 3].reduce((acc, i) => acc + hourly[(s + i) % 24], 0);
    if (w / sum > best.share) best = { start: s, share: w / sum };
  }
  if (best.share >= 0.4) out.push(`Les utilisateurs sont particulièrement actifs entre ${best.start} h et ${(best.start + 4) % 24 || 24} h (${Math.round(best.share * 100)} % de l'activité sur 4 heures).`);
  const total = daily.reduce((a, b) => a + b, 0);
  const topDay = daily.indexOf(Math.max(...daily));
  if (total && daily[topDay] / total >= 0.22) out.push(`${WEEKDAYS[topDay]} est le jour le plus actif (${Math.round((daily[topDay] / total) * 100)} % de l'activité).`);
  const quiet = hourly.map((v, h) => ({ v, h })).filter((x) => x.h >= 7 && x.h <= 23).sort((a, b) => a.v - b.v)[0];
  if (quiet && quiet.v / sum < 0.01) out.push(`L'activité est très faible vers ${quiet.h} h.`);
  return out;
}

// ── Tendances par granularité ────────────────────────────────────────────────
export type Granularity = "day" | "week" | "month" | "quarter";
export const GRANULARITY_LABELS: Record<Granularity, string> = { day: "Quotidienne", week: "Hebdomadaire", month: "Mensuelle", quarter: "Trimestrielle" };
export interface TrendPoint { bucket: Date; activeUsers: number; sessions: number; events: number; change: number | null }

export function getTrend(g: Granularity): Promise<TrendPoint[]> {
  return cached(`trend:${g}:${startOfDay(new Date()).getTime()}`, () => computeTrend(g));
}

async function computeTrend(g: Granularity): Promise<TrendPoint[]> {
  const now = new Date();
  const today = startOfDay(now);
  const from = g === "day" ? new Date(today.getTime() - 29 * DAY) : g === "week" ? truncate(new Date(today.getTime() - 11 * 7 * DAY), "week") : g === "month" ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1)) : new Date(Date.UTC(today.getUTCFullYear(), Math.floor(today.getUTCMonth() / 3) * 3 - 9, 1));
  const [ev, se] = await Promise.all([
    db.$queryRaw<{ bucket: Date; users: bigint; events: bigint }[]>`
      SELECT date_trunc(${g}::text, "createdAt") AS bucket, count(DISTINCT "actorKey") AS users, count(*) AS events
      FROM "AnalyticsEvent" WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${from} AND "createdAt" <= ${now} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ bucket: Date; sessions: bigint }[]>`
      WITH ${sessionsCte(from, now)}
      SELECT date_trunc(${g}::text, started) AS bucket, count(*) AS sessions FROM sessions GROUP BY 1 ORDER BY 1`,
  ]);
  const sess = new Map(se.map((r) => [r.bucket.getTime(), n(r.sessions)]));
  const step = (d: Date) => (g === "day" ? new Date(d.getTime() + DAY) : g === "week" ? new Date(d.getTime() + 7 * DAY) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (g === "month" ? 1 : 3), 1)));
  const byTime = new Map(ev.map((r) => [r.bucket.getTime(), r]));
  const points: TrendPoint[] = [];
  let cur = g === "quarter" ? new Date(Date.UTC(from.getUTCFullYear(), Math.floor(from.getUTCMonth() / 3) * 3, 1)) : truncate(from, g === "day" ? "day" : g === "week" ? "week" : "month");
  while (cur <= now && points.length < 60) {
    const r = byTime.get(cur.getTime());
    const prev = points.at(-1);
    const users = n(r?.users);
    points.push({ bucket: cur, activeUsers: users, sessions: sess.get(cur.getTime()) ?? 0, events: n(r?.events), change: prev && prev.activeUsers > 0 ? round1(((users - prev.activeUsers) / prev.activeUsers) * 100) : null });
    cur = step(cur);
  }
  return points;
}

// ── Comparaison des catégories d'utilisateurs ────────────────────────────────
export interface CategoryRow {
  key: CategoryKey;
  label: string;
  accounts: number;
  active: number;
  sessions: number;
  sessionsPerUser: number | null;
  avgSessionMin: number | null;
  eventsPerUser: number | null;
  exercisesDone: number;
  exercisesPerUser: number | null;
  assistantMessages: number;
}

export function getCategoryComparison(period: Period): Promise<CategoryRow[]> {
  return cached(`cats:${periodKey(period)}`, async () => {
    await ensureActorKeys();
    const keys = Object.keys(CATEGORIES) as CategoryKey[];
    const [accounts, ev, ses, ex] = await Promise.all([
      db.$queryRaw<{ c: string | null; v: bigint }[]>`SELECT p.category AS c, count(*) AS v FROM "User" u LEFT JOIN "StudentProfile" p ON p."userId" = u.id WHERE u."adminRole" IS NULL GROUP BY 1`,
      db.$queryRaw<{ c: string | null; users: bigint; events: bigint; ai: bigint }[]>`
        SELECT category AS c, count(DISTINCT "actorKey") AS users, count(*) AS events, count(*) FILTER (WHERE type = 'assistant.message') AS ai
        FROM "AnalyticsEvent" WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${period.from} AND "createdAt" <= ${period.to} GROUP BY 1`,
      db.$queryRaw<{ c: string | null; s: bigint; m: number | null }[]>`
        WITH ${sessionsCte(period.from, period.to)}
        SELECT category AS c, count(*) AS s, avg(extract(epoch FROM (ended - started)) / 60.0) AS m FROM sessions GROUP BY 1`,
      db.$queryRaw<{ c: string | null; v: bigint }[]>`
        SELECT p.category AS c, count(*) AS v FROM "ExerciseAttempt" a LEFT JOIN "StudentProfile" p ON p."userId" = a."userId"
        WHERE a.status IN ('GRADED','SUBMITTED') AND a."finishedAt" >= ${period.from} AND a."finishedAt" <= ${period.to} GROUP BY 1`,
    ]);
    const pick = <T extends { c: string | null }>(rows: T[], k: CategoryKey) => rows.find((r) => (r.c ?? "NONE") === k);
    return keys.map((k) => {
      const users = n(pick(ev, k)?.users);
      const sessions = n(pick(ses, k)?.s);
      const done = n(pick(ex, k)?.v);
      const m = pick(ses, k)?.m;
      return {
        key: k,
        label: CATEGORIES[k],
        accounts: n(pick(accounts, k)?.v),
        active: users,
        sessions,
        sessionsPerUser: users ? round1(sessions / users) : null,
        avgSessionMin: m == null ? null : round1(Number(m)),
        eventsPerUser: users ? round1(n(pick(ev, k)?.events) / users) : null,
        exercisesDone: done,
        exercisesPerUser: users ? round1(done / users) : null,
        assistantMessages: n(pick(ev, k)?.ai),
      };
    });
  });
}

// ── Fidélisation ─────────────────────────────────────────────────────────────
export interface CohortRow {
  cohort: Date;
  size: number;
  /** null : cohorte trop récente pour que J1/J7/J30 soit calculable (aucun taux inventé). */
  d1: number | null;
  d7: number | null;
  d30: number | null;
}
export interface Retention {
  cohorts: CohortRow[];
  overall: { d1: number | null; d7: number | null; d30: number | null; eligible: { d1: number; d7: number; d30: number } };
  returned: { users: number; signups: number; rate: number | null };
  fading: { dropped: number; declining: number; base: number };
  liveSince: Date | null;
}

const returnedOn = (day: number) => Prisma.sql`EXISTS (
  SELECT 1 FROM "AnalyticsEvent" e WHERE e."actorKey" = u."actorKey" AND e.type IN (${activeTypesSql})
    AND e."createdAt" >= date_trunc('day', u."createdAt") + (${day}::int * interval '1 day')
    AND e."createdAt" <  date_trunc('day', u."createdAt") + (${day + 1}::int * interval '1 day'))`;

export function getRetention(): Promise<Retention> {
  return cached(`retention:${startOfDay(new Date()).getTime()}`, async () => {
    await ensureActorKeys();
    const now = Date.now();
    const lim = (d: number) => new Date(now - (d + 1) * DAY);
    const from = new Date(now - 12 * 7 * DAY);
    const rows = await db.$queryRaw<{ cohort: Date; size: bigint; e1: bigint; r1: bigint; e7: bigint; r7: bigint; e30: bigint; r30: bigint }[]>`
      SELECT date_trunc('week', u."createdAt") AS cohort, count(*) AS size,
        count(*) FILTER (WHERE u."createdAt" <= ${lim(1)}) AS e1, count(*) FILTER (WHERE u."createdAt" <= ${lim(1)} AND ${returnedOn(1)}) AS r1,
        count(*) FILTER (WHERE u."createdAt" <= ${lim(7)}) AS e7, count(*) FILTER (WHERE u."createdAt" <= ${lim(7)} AND ${returnedOn(7)}) AS r7,
        count(*) FILTER (WHERE u."createdAt" <= ${lim(30)}) AS e30, count(*) FILTER (WHERE u."createdAt" <= ${lim(30)} AND ${returnedOn(30)}) AS r30
      FROM "User" u WHERE u."adminRole" IS NULL AND u."createdAt" >= ${truncate(from, "week")} GROUP BY 1 ORDER BY 1`;
    const cohorts: CohortRow[] = rows.map((r) => ({ cohort: r.cohort, size: n(r.size), d1: ratio(n(r.r1), n(r.e1)), d7: ratio(n(r.r7), n(r.e7)), d30: ratio(n(r.r30), n(r.e30)) }));
    const sum = (k: "e1" | "r1" | "e7" | "r7" | "e30" | "r30") => rows.reduce((s, r) => s + n(r[k]), 0);

    const back = await db.$queryRaw<{ signups: bigint; back: bigint }[]>`
      SELECT count(*) AS signups,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "AnalyticsEvent" e WHERE e."actorKey" = u."actorKey" AND e.type IN (${activeTypesSql}) AND e."createdAt" >= date_trunc('day', u."createdAt") + interval '1 day')) AS back
      FROM "User" u WHERE u."adminRole" IS NULL AND u."createdAt" <= ${new Date(now - DAY)}`;
    const cut30 = new Date(now - 30 * DAY);
    const cut60 = new Date(now - 60 * DAY);
    const fade = await db.$queryRaw<{ base: bigint; dropped: bigint; declining: bigint }[]>`
      WITH act AS (
        SELECT "actorKey",
               count(DISTINCT date_trunc('day', "createdAt")) FILTER (WHERE "createdAt" >= ${cut60} AND "createdAt" < ${cut30}) AS before,
               count(DISTINCT date_trunc('day', "createdAt")) FILTER (WHERE "createdAt" >= ${cut30}) AS after
        FROM "AnalyticsEvent" WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${cut60} GROUP BY "actorKey")
      SELECT count(*) FILTER (WHERE before >= 2) AS base,
             count(*) FILTER (WHERE before >= 2 AND after = 0) AS dropped,
             count(*) FILTER (WHERE before >= 2 AND after > 0 AND after * 2 < before) AS declining
      FROM act`;
    const cov = await coverage();
    return {
      cohorts,
      overall: { d1: ratio(sum("r1"), sum("e1")), d7: ratio(sum("r7"), sum("e7")), d30: ratio(sum("r30"), sum("e30")), eligible: { d1: sum("e1"), d7: sum("e7"), d30: sum("e30") } },
      returned: { users: n(back[0]?.back), signups: n(back[0]?.signups), rate: ratio(n(back[0]?.back), n(back[0]?.signups)) },
      fading: { base: n(fade[0]?.base), dropped: n(fade[0]?.dropped), declining: n(fade[0]?.declining) },
      liveSince: cov.liveSince,
    };
  });
}
