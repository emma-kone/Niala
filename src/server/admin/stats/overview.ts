import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_TYPES, INACTIVE_AFTER_DAYS, categoryLabel } from "@/server/analytics/definitions";
import { activeTypesSql, bucketSql, cached, coverage, ensureActorKeys, fillSeries, metric, n, periodKey, ratio, round1, sessionsCte, startOfDay, type Metric, type Period } from "@/server/admin/stats/common";

// Vue d'ensemble : indicateurs clés comparés à la période précédente, et séries des graphiques principaux.
// Chaque indicateur indique d'où vient sa donnée : « table » (historique complet, lu dans les tables d'origine) ou
// « événements » (collecte en direct, valable depuis le début de la collecte seulement).

export type Source = "table" | "events";

export interface Kpi extends Metric {
  key: string;
  label: string;
  unit?: "%" | "min" | "";
  source: Source;
  hint?: string;
}

const DAY = 86_400_000;
const PEDAGOGIC = ["exercise.generate", "exercise.start", "exercise.complete", "document.import", "exercise.import", "map.create", "assistant.message", "lab.run", "lab.create"];

async function activeUsers(from: Date, to: Date): Promise<number> {
  const r = await db.$queryRaw<{ c: bigint }[]>`SELECT count(DISTINCT "actorKey") AS c FROM "AnalyticsEvent" WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${from} AND "createdAt" <= ${to}`;
  return n(r[0]?.c);
}

async function pedagogicUsers(from: Date, to: Date): Promise<number> {
  const r = await db.$queryRaw<{ c: bigint }[]>`SELECT count(DISTINCT "actorKey") AS c FROM "AnalyticsEvent" WHERE type IN (${Prisma.join(PEDAGOGIC)}) AND "createdAt" >= ${from} AND "createdAt" <= ${to}`;
  return n(r[0]?.c);
}

async function sessionStats(from: Date, to: Date) {
  const r = await db.$queryRaw<{ total: bigint; avg_min: number | null; users: bigint }[]>`
    WITH ${sessionsCte(from, to)}
    SELECT count(*) AS total, avg(extract(epoch FROM (ended - started)) / 60.0) AS avg_min, count(DISTINCT "actorKey") AS users FROM sessions`;
  const row = r[0];
  return { total: n(row?.total), avgMin: row?.avg_min == null ? null : Number(row.avg_min), users: n(row?.users) };
}

/** Part des utilisateurs actifs de la période ayant été actifs sur au moins deux jours distincts. */
async function returning(from: Date, to: Date) {
  const r = await db.$queryRaw<{ active: bigint; back: bigint; days: number | null }[]>`
    WITH per AS (
      SELECT "actorKey", count(DISTINCT date_trunc('day', "createdAt")) AS days
      FROM "AnalyticsEvent" WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${from} AND "createdAt" <= ${to} GROUP BY "actorKey")
    SELECT count(*) AS active, count(*) FILTER (WHERE days >= 2) AS back, avg(days) AS days FROM per`;
  const row = r[0];
  return { active: n(row?.active), back: n(row?.back), avgDays: row?.days == null ? null : Number(row.days) };
}

/** Rétention à J7 des comptes créés dans la fenêtre : seuls les comptes ayant déjà « vécu » 7 jours sont comptés. */
export async function retentionAt(day: number, from: Date, to: Date): Promise<{ eligible: number; retained: number; rate: number | null }> {
  await ensureActorKeys();
  const limit = new Date(Date.now() - (day + 1) * DAY);
  const r = await db.$queryRaw<{ eligible: bigint; retained: bigint }[]>`
    SELECT count(*) AS eligible,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM "AnalyticsEvent" e
             WHERE e."actorKey" = u."actorKey" AND e.type IN (${activeTypesSql})
               AND e."createdAt" >= date_trunc('day', u."createdAt") + (${day}::int * interval '1 day')
               AND e."createdAt" <  date_trunc('day', u."createdAt") + (${day + 1}::int * interval '1 day'))) AS retained
    FROM "User" u WHERE u."createdAt" >= ${from} AND u."createdAt" <= ${to} AND u."createdAt" <= ${limit} AND u."adminRole" IS NULL`;
  const eligible = n(r[0]?.eligible);
  const retained = n(r[0]?.retained);
  return { eligible, retained, rate: ratio(retained, eligible) };
}

export interface Overview {
  period: Period;
  coverage: Awaited<ReturnType<typeof coverage>>;
  kpis: { users: Kpi[]; usage: Kpi[]; engagement: Kpi[] };
  series: {
    registrations: { bucket: Date; value: number }[];
    activeUsers: { bucket: Date; value: number }[];
    sessions: { bucket: Date; value: number }[];
    exercises: { bucket: Date; value: number }[];
    engagement: { bucket: Date; value: number }[];
  };
  categories: { key: string; label: string; value: number }[];
  insights: string[];
}

export function getOverview(period: Period): Promise<Overview> {
  return cached(`overview:${periodKey(period)}`, () => computeOverview(period));
}

async function computeOverview(p: Period): Promise<Overview> {
  const now = new Date();
  const today = startOfDay(now);
  const cov = await coverage();
  await ensureActorKeys();
  const k = (key: string, label: string, source: Source, m: Metric, extra: Partial<Kpi> = {}): Kpi => ({ key, label, source, ...m, ...extra });

  const [
    totalNow, totalPrev, newCur, newPrev,
    actToday, actYesterday, act7, act7Prev, act30, act30Prev, actPeriod, actPeriodPrev,
    inactive, pedCur, pedPrev, retention, retentionPrev,
    sessCur, sessPrev, retCur, retPrev,
    attemptsCur, attemptsPrev, docsCur, docsPrev, mapsCur, mapsPrev, coursesCur, coursesPrev, eventsCur, eventsPrev,
  ] = await Promise.all([
    db.user.count({ where: { createdAt: { lte: p.to }, adminRole: null } }),
    db.user.count({ where: { createdAt: { lte: p.prevTo }, adminRole: null } }),
    db.user.count({ where: { createdAt: { gte: p.from, lte: p.to }, adminRole: null } }),
    db.user.count({ where: { createdAt: { gte: p.prevFrom, lte: p.prevTo }, adminRole: null } }),
    activeUsers(today, now),
    activeUsers(new Date(today.getTime() - DAY), new Date(now.getTime() - DAY)),
    activeUsers(new Date(today.getTime() - 6 * DAY), now),
    activeUsers(new Date(today.getTime() - 13 * DAY), new Date(today.getTime() - 6 * DAY - 1)),
    activeUsers(new Date(today.getTime() - 29 * DAY), now),
    activeUsers(new Date(today.getTime() - 59 * DAY), new Date(today.getTime() - 29 * DAY - 1)),
    activeUsers(p.from, p.to),
    activeUsers(p.prevFrom, p.prevTo),
    inactiveUsers(),
    pedagogicUsers(p.from, p.to),
    pedagogicUsers(p.prevFrom, p.prevTo),
    retentionAt(7, p.from, p.to),
    retentionAt(7, p.prevFrom, p.prevTo),
    sessionStats(p.from, p.to),
    sessionStats(p.prevFrom, p.prevTo),
    returning(p.from, p.to),
    returning(p.prevFrom, p.prevTo),
    db.exerciseAttempt.count({ where: { status: { in: ["GRADED", "SUBMITTED"] }, finishedAt: { gte: p.from, lte: p.to } } }),
    db.exerciseAttempt.count({ where: { status: { in: ["GRADED", "SUBMITTED"] }, finishedAt: { gte: p.prevFrom, lte: p.prevTo } } }),
    db.document.count({ where: { createdAt: { gte: p.from, lte: p.to } } }),
    db.document.count({ where: { createdAt: { gte: p.prevFrom, lte: p.prevTo } } }),
    db.mindMap.count({ where: { createdAt: { gte: p.from, lte: p.to } } }),
    db.mindMap.count({ where: { createdAt: { gte: p.prevFrom, lte: p.prevTo } } }),
    countEvents("course.view", p.from, p.to),
    countEvents("course.view", p.prevFrom, p.prevTo),
    countActiveEvents(p.from, p.to),
    countActiveEvents(p.prevFrom, p.prevTo),
  ]);

  // Une évolution n'est affichée que si la période précédente est couverte par des données (début de collecte ≤ début de la période précédente).
  const covers = (from: Date) => cov.liveSince != null && cov.liveSince <= from;
  const guard = (m: Metric, from: Date, needsEvents: boolean): Metric => (needsEvents && !covers(from) ? { ...m, change: null, previous: null } : m);
  const perDay = Math.max(1, (p.to.getTime() - p.from.getTime()) / DAY);

  const users: Kpi[] = [
    k("total", "Utilisateurs inscrits", "table", metric(totalNow, totalPrev)),
    k("new", "Nouveaux inscrits", "table", metric(newCur, newPrev)),
    k("active-today", "Actifs aujourd'hui", "events", guard(metric(actToday, actYesterday), new Date(today.getTime() - DAY), true), { hint: "Comparé à la veille, à la même heure." }),
    k("active-7d", "Actifs sur 7 jours", "events", guard(metric(act7, act7Prev), new Date(today.getTime() - 13 * DAY), true)),
    k("active-30d", "Actifs sur 30 jours", "events", guard(metric(act30, act30Prev), new Date(today.getTime() - 59 * DAY), true)),
    k("active-period", "Actifs sur la période", "events", guard(metric(actPeriod, actPeriodPrev), p.prevFrom, true)),
    k("inactive", "Utilisateurs inactifs", "events", metric(inactive, null), { hint: `Comptes de plus de ${INACTIVE_AFTER_DAYS} jours sans activité significative depuis ${INACTIVE_AFTER_DAYS} jours.` }),
    k("pedagogic", "Avec une activité pédagogique", "events", guard(metric(pedCur, pedPrev), p.prevFrom, true)),
    k("retention-d7", "Rétention à J7", "events", metric(retention.rate, retentionPrev.rate), { unit: "%", hint: retention.eligible ? `${retention.retained} sur ${retention.eligible} inscrits revenus au 7ᵉ jour.` : "Aucun inscrit de la période n'a encore atteint 7 jours." }),
  ];

  const usage: Kpi[] = [
    k("sessions", "Sessions", "events", guard(metric(sessCur.total, sessPrev.total), p.prevFrom, true)),
    k("sessions-day", "Sessions par jour", "events", guard(metric(round1(sessCur.total / perDay), round1(sessPrev.total / perDay)), p.prevFrom, true)),
    k("session-duration", "Durée moyenne d'une session", "events", guard(metric(round1(sessCur.avgMin), round1(sessPrev.avgMin)), p.prevFrom, true), { unit: "min", hint: "Écart entre le premier et le dernier événement d'une session." }),
    k("sessions-user", "Sessions par utilisateur", "events", guard(metric(sessCur.users ? round1(sessCur.total / sessCur.users) : null, sessPrev.users ? round1(sessPrev.total / sessPrev.users) : null), p.prevFrom, true)),
    k("exercises-done", "Exercices réalisés", "table", metric(attemptsCur, attemptsPrev)),
    k("courses-viewed", "Cours consultés", "events", guard(metric(coursesCur, coursesPrev), p.prevFrom, true)),
    k("documents", "Documents importés", "table", metric(docsCur, docsPrev)),
    k("maps", "Cartes mentales créées", "table", metric(mapsCur, mapsPrev)),
  ];

  const engagement: Kpi[] = [
    k("returning", "Utilisateurs revenant", "events", guard(metric(ratio(retCur.back, retCur.active), ratio(retPrev.back, retPrev.active)), p.prevFrom, true), { unit: "%", hint: "Actifs sur au moins deux jours distincts de la période." }),
    k("frequency", "Jours d'activité par utilisateur", "events", guard(metric(round1(retCur.avgDays), round1(retPrev.avgDays)), p.prevFrom, true), { hint: "Moyenne des jours distincts d'activité parmi les actifs de la période." }),
    k("activity", "Activité globale", "events", guard(metric(eventsCur, eventsPrev), p.prevFrom, true), { hint: "Nombre d'actions significatives." }),
  ];

  const [registrations, active, sessions, exercises, events, cats] = await Promise.all([
    registrationSeries(p), activeSeries(p), sessionSeries(p), exerciseSeries(p), eventSeries(p), categorySplit(),
  ]);
  const engagementSeries = active.map((a, i) => ({ bucket: a.bucket, value: a.value ? round1((events[i]?.value ?? 0) / a.value) ?? 0 : 0 }));

  const insights: string[] = [];
  if (!cov.liveSince) insights.push("Aucun événement d'usage n'a encore été collecté : les indicateurs « événements » s'affichent à partir des premières actions des étudiants.");
  else if (cov.liveSince > p.from) insights.push(`La collecte des événements d'usage a démarré le ${cov.liveSince.toISOString().slice(0, 10)} : les indicateurs « événements » ne couvrent pas la période avant cette date.`);

  return { period: p, coverage: cov, kpis: { users, usage, engagement }, series: { registrations, activeUsers: active, sessions, exercises, engagement: engagementSeries }, categories: cats, insights };
}

async function countEvents(type: string, from: Date, to: Date) {
  return db.analyticsEvent.count({ where: { type, createdAt: { gte: from, lte: to } } });
}
async function countActiveEvents(from: Date, to: Date) {
  return db.analyticsEvent.count({ where: { type: { in: [...ACTIVE_TYPES] }, createdAt: { gte: from, lte: to } } });
}

async function inactiveUsers(): Promise<number> {
  const cut = new Date(Date.now() - INACTIVE_AFTER_DAYS * DAY);
  const r = await db.$queryRaw<{ c: bigint }[]>`
    SELECT count(*) AS c FROM "User" u
    WHERE u."adminRole" IS NULL AND u."accountStatus" = 'ACTIVE' AND u."createdAt" < ${cut}
      AND NOT EXISTS (SELECT 1 FROM "AnalyticsEvent" e WHERE e."actorKey" = u."actorKey" AND e.type IN (${activeTypesSql}) AND e."createdAt" >= ${cut})`;
  return n(r[0]?.c);
}

type Point = { bucket: Date; value: number };
const empty = (bucket: Date): Point => ({ bucket, value: 0 });

async function registrationSeries(p: Period): Promise<Point[]> {
  const rows = await db.$queryRaw<{ bucket: Date; value: bigint }[]>`
    SELECT ${bucketSql(p.bucket)} AS bucket, count(*) AS value FROM "User"
    WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} AND "adminRole" IS NULL GROUP BY 1 ORDER BY 1`;
  return fillSeries(rows.map((r) => ({ bucket: r.bucket, value: n(r.value) })), p, empty);
}

async function activeSeries(p: Period): Promise<Point[]> {
  const rows = await db.$queryRaw<{ bucket: Date; value: bigint }[]>`
    SELECT ${bucketSql(p.bucket)} AS bucket, count(DISTINCT "actorKey") AS value FROM "AnalyticsEvent"
    WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 1`;
  return fillSeries(rows.map((r) => ({ bucket: r.bucket, value: n(r.value) })), p, empty);
}

async function eventSeries(p: Period): Promise<Point[]> {
  const rows = await db.$queryRaw<{ bucket: Date; value: bigint }[]>`
    SELECT ${bucketSql(p.bucket)} AS bucket, count(*) AS value FROM "AnalyticsEvent"
    WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 1`;
  return fillSeries(rows.map((r) => ({ bucket: r.bucket, value: n(r.value) })), p, empty);
}

async function sessionSeries(p: Period): Promise<Point[]> {
  const rows = await db.$queryRaw<{ bucket: Date; value: bigint }[]>`
    WITH ${sessionsCte(p.from, p.to)}
    SELECT ${bucketSql(p.bucket, Prisma.raw("started"))} AS bucket, count(*) AS value FROM sessions GROUP BY 1 ORDER BY 1`;
  return fillSeries(rows.map((r) => ({ bucket: r.bucket, value: n(r.value) })), p, empty);
}

async function exerciseSeries(p: Period): Promise<Point[]> {
  const rows = await db.$queryRaw<{ bucket: Date; value: bigint }[]>`
    SELECT ${bucketSql(p.bucket, Prisma.raw('"finishedAt"'))} AS bucket, count(*) AS value FROM "ExerciseAttempt"
    WHERE status IN ('GRADED','SUBMITTED') AND "finishedAt" >= ${p.from} AND "finishedAt" <= ${p.to} GROUP BY 1 ORDER BY 1`;
  return fillSeries(rows.map((r) => ({ bucket: r.bucket, value: n(r.value) })), p, empty);
}

async function categorySplit() {
  const rows = await db.$queryRaw<{ category: string | null; value: bigint }[]>`
    SELECT p.category AS category, count(*) AS value FROM "User" u LEFT JOIN "StudentProfile" p ON p."userId" = u.id
    WHERE u."adminRole" IS NULL GROUP BY 1 ORDER BY 2 DESC`;
  return rows.map((r) => ({ key: r.category ?? "NONE", label: categoryLabel(r.category), value: n(r.value) }));
}

