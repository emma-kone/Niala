import { Prisma } from "@prisma/client";
// Statistiques : client non filtré, les contenus supprimés par les étudiants restent comptés.
import { dbAll as db } from "@/lib/db";
import { actorKeyOf } from "@/server/analytics/track";
import { ACTIVE_TYPES, SESSION_GAP_MIN } from "@/server/analytics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Outils communs des statistiques : périodes, cache, évolutions, requêtes partagées.
// Fuseau d'analyse : UTC (identique à Abidjan, sans heure d'été). Les jours, semaines et heures sont ceux de l'UTC.
// ─────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

export const PERIOD_KEYS = ["today", "7d", "30d", "3m", "6m", "12m", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];
export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Aujourd'hui",
  "7d": "7 derniers jours",
  "30d": "30 derniers jours",
  "3m": "3 derniers mois",
  "6m": "6 derniers mois",
  "12m": "12 derniers mois",
  custom: "Période personnalisée",
};
export type Bucket = "hour" | "day" | "week" | "month";

export interface Period {
  key: PeriodKey;
  label: string;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  bucket: Bucket;
  /** Paramètres d'URL qui reproduisent cette période (liens, exports). */
  query: string;
}

export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const parseDay = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : null);

export function resolvePeriod(params: { p?: string; from?: string; to?: string }, now = new Date()): Period {
  let key = (PERIOD_KEYS as readonly string[]).includes(params.p ?? "") ? (params.p as PeriodKey) : "30d";
  const today = startOfDay(now);
  let from: Date;
  let to: Date = now;
  if (key === "custom") {
    const f = parseDay(params.from);
    const t = parseDay(params.to);
    if (f && t && f <= t) {
      from = f;
      to = new Date(Math.min(addDays(t, 1).getTime() - 1, now.getTime()));
      if (to < from) to = now;
    } else {
      key = "30d";
      from = addDays(today, -29);
    }
  } else if (key === "today") from = today;
  else if (key === "7d") from = addDays(today, -6);
  else if (key === "30d") from = addDays(today, -29);
  else if (key === "3m") from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, today.getUTCDate()));
  else if (key === "6m") from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, today.getUTCDate()));
  else from = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth(), today.getUTCDate()));

  const spanDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY));
  const shift = spanDays * DAY;
  const bucket: Bucket = key === "today" ? "hour" : spanDays <= 62 ? "day" : spanDays <= 190 ? "week" : "month";
  const query = key === "custom" ? `p=custom&from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}` : `p=${key}`;
  const label = key === "custom" ? `Du ${from.toISOString().slice(0, 10)} au ${to.toISOString().slice(0, 10)}` : PERIOD_LABELS[key];
  return { key, label, from, to, prevFrom: new Date(from.getTime() - shift), prevTo: new Date(to.getTime() - shift), bucket, query };
}

// ── Cache mémoire à courte durée de vie : les agrégats lourds ne sont pas recalculés à chaque rafraîchissement ──
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = process.env.NODE_ENV === "test" ? 0 : 60_000;

export async function cached<T>(key: string, fn: () => Promise<T>, ttl = TTL_MS): Promise<T> {
  const hit = cache.get(key);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await fn();
  if (ttl > 0) {
    if (cache.size > 400) cache.clear();
    cache.set(key, { at: Date.now(), value });
  }
  return value;
}
export const clearStatsCache = () => cache.clear();
export const periodKey = (p: Period) => `${p.from.getTime()}-${p.to.getTime()}-${p.bucket}`;

// ── Valeurs et évolutions ──
export interface Metric {
  value: number | null;
  previous: number | null;
  /** Évolution en % ; null quand la période précédente n'a pas de donnée (jamais de pourcentage inventé). */
  change: number | null;
}

export function metric(value: number | null, previous: number | null): Metric {
  const change = value != null && previous != null && previous > 0 ? Math.round(((value - previous) / previous) * 1000) / 10 : null;
  return { value, previous, change };
}

export const n = (v: unknown): number => (typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : Number(v ?? 0));
export const ratio = (a: number, b: number): number | null => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
export const round1 = (v: number | null | undefined) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

export const activeTypesSql = Prisma.join(ACTIVE_TYPES as readonly string[]);

// ── Événements : première date de collecte (pour signaler l'absence d'historique antérieur) ──
export interface Coverage {
  /** Début de la collecte en direct ; null si rien n'a encore été collecté. */
  liveSince: Date | null;
  liveEvents: number;
  backfilled: number;
}

export async function coverage(): Promise<Coverage> {
  return cached("coverage", async () => {
    const rows = await db.$queryRaw<{ since: Date | null; live: bigint; back: bigint }[]>`
      SELECT min("createdAt") FILTER (WHERE source = 'LIVE') AS since,
             count(*) FILTER (WHERE source = 'LIVE') AS live,
             count(*) FILTER (WHERE source = 'BACKFILL') AS back
      FROM "AnalyticsEvent"`;
    const r = rows[0];
    return { liveSince: r?.since ?? null, liveEvents: n(r?.live), backfilled: n(r?.back) };
  });
}

// ── Pseudonymes : fait correspondre les comptes à leurs événements ──
/** Calcule le pseudonyme des comptes qui n'en ont pas encore (par lots). Idempotent. */
export async function ensureActorKeys(): Promise<number> {
  let done = 0;
  for (;;) {
    const users = await db.user.findMany({ where: { actorKey: null }, select: { id: true }, take: 500 });
    if (!users.length) return done;
    await db.$transaction(users.map((u) => db.user.update({ where: { id: u.id }, data: { actorKey: actorKeyOf(u.id) } })));
    done += users.length;
  }
}

// ── Sessions : voir SESSION_GAP_MIN dans analytics/definitions.ts ──
const GAP = Prisma.raw(`${SESSION_GAP_MIN} minutes`);
export const SESSION_GAP_SQL = GAP;

/**
 * Expression de table « sessions » : une ligne par session démarrée dans [from, to].
 * Seuls les événements collectés en direct comptent (les événements reconstitués sont des jalons isolés, pas une présence).
 */
export function sessionsCte(from: Date, to: Date) {
  return Prisma.sql`
    ev AS (
      SELECT "actorKey", "createdAt", category,
             CASE WHEN lag("createdAt") OVER w IS NULL OR "createdAt" - lag("createdAt") OVER w > interval '${GAP}' THEN 1 ELSE 0 END AS starts
      FROM "AnalyticsEvent"
      WHERE source = 'LIVE' AND type <> 'page.load' AND "createdAt" >= ${new Date(from.getTime() - SESSION_GAP_MIN * 60_000)} AND "createdAt" <= ${to}
      WINDOW w AS (PARTITION BY "actorKey" ORDER BY "createdAt")
    ),
    numbered AS (
      SELECT *, sum(starts) OVER (PARTITION BY "actorKey" ORDER BY "createdAt") AS sid FROM ev
    ),
    sessions AS (
      SELECT "actorKey", sid, min("createdAt") AS started, max("createdAt") AS ended, max(category) AS category
      FROM numbered GROUP BY "actorKey", sid
      HAVING min("createdAt") >= ${from}
    )`;
}

export function bucketSql(bucket: Bucket, column = Prisma.raw('"createdAt"')) {
  return Prisma.sql`date_trunc(${bucket}::text, ${column})`;
}

/** Série continue : complète les périodes sans événement par 0 (un trou n'est pas une donnée manquante, c'est une absence d'activité). */
export function fillSeries<T extends { bucket: Date }>(rows: T[], period: Period, empty: (bucket: Date) => T): T[] {
  const byTime = new Map(rows.map((r) => [r.bucket.getTime(), r]));
  const out: T[] = [];
  const step = (d: Date): Date => {
    if (period.bucket === "hour") return new Date(d.getTime() + 3_600_000);
    if (period.bucket === "day") return addDays(d, 1);
    if (period.bucket === "week") return addDays(d, 7);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  };
  let cur = truncate(period.from, period.bucket);
  while (cur <= period.to && out.length < 800) {
    out.push(byTime.get(cur.getTime()) ?? empty(cur));
    cur = step(cur);
  }
  return out;
}

export function truncate(d: Date, bucket: Bucket): Date {
  if (bucket === "hour") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()));
  if (bucket === "day") return startOfDay(d);
  if (bucket === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const day = startOfDay(d);
  return addDays(day, -((day.getUTCDay() + 6) % 7)); // semaine ISO : lundi
}
