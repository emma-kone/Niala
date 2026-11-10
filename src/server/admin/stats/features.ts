import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ABANDON_AFTER_DAYS, FEATURES, MODULES, isModule, type FeatureDef } from "@/server/analytics/definitions";
import { activeTypesSql, cached, metric, n, periodKey, ratio, round1, type Metric, type Period } from "@/server/admin/stats/common";

// Analyse des fonctionnalités : usage, adoption, abandon, erreurs et temps de traitement de chacune.

/** Opérations IA (AIUsageLog.op) rattachées à une fonctionnalité : source des erreurs et des temps de traitement. */
const AI_OPS: Record<string, string[]> = {
  "exercise-generation": ["exercise.generate"],
  "exercise-import": ["exercise.import"],
  assistant: ["chat.turn", "lab.assistant"],
  "mind-maps": ["maps."],
  "document-import": ["analysis.", "index.embed"],
};

export interface FeatureStats {
  key: string;
  label: string;
  uniqueUsers: Metric;
  uses: Metric;
  /** Utilisations par utilisateur ayant utilisé la fonctionnalité. */
  frequency: number | null;
  /** Part des utilisateurs actifs de la période ayant utilisé la fonctionnalité. */
  adoption: number | null;
  /** null quand la notion d'abandon n'a pas de sens pour cette fonctionnalité. */
  abandonment: { started: number; completed: number; abandoned: number; rate: number | null } | null;
  errors: { count: number; rate: number | null; source: "IA" | "événements" };
  avgProcessingMs: number | null;
  flags: string[];
}

export interface RecommendationStats {
  shown: number;
  followed: number;
  dismissed: number;
  pending: number;
  /** Part des suggestions affichées qui ont été suivies (démarrées ou terminées). */
  followRate: number | null;
}

export interface FeatureReport {
  period: Period;
  recommendations: RecommendationStats;
  activeUsers: number;
  features: FeatureStats[];
  popular: FeatureStats[];
  needsWork: { feature: FeatureStats; reasons: string[] }[];
  modules: { key: string; label: string; opens: number; users: number }[];
}

export function getFeatureReport(period: Period): Promise<FeatureReport> {
  return cached(`features:${periodKey(period)}`, () => compute(period));
}

async function usage(f: FeatureDef, from: Date, to: Date) {
  const types = Prisma.join(f.uses);
  const r = await db.$queryRaw<{ users: bigint; uses: bigint; failed: bigint; avg_ms: number | null }[]>`
    SELECT count(DISTINCT "actorKey") AS users, count(*) AS uses, count(*) FILTER (WHERE ok = false) AS failed, avg("durationMs") AS avg_ms
    FROM "AnalyticsEvent" WHERE type IN (${types}) AND "createdAt" >= ${from} AND "createdAt" <= ${to}`;
  return { users: n(r[0]?.users), uses: n(r[0]?.uses), failed: n(r[0]?.failed), avgMs: r[0]?.avg_ms == null ? null : Number(r[0].avg_ms) };
}

async function aiStats(key: string, from: Date, to: Date) {
  const prefixes = AI_OPS[key];
  if (!prefixes) return null;
  const cond = Prisma.join(prefixes.map((p) => Prisma.sql`op LIKE ${p + "%"}`), " OR ");
  const r = await db.$queryRaw<{ calls: bigint; failed: bigint; avg_ms: number | null }[]>`
    SELECT count(*) AS calls, count(*) FILTER (WHERE ok = false) AS failed, avg("durationMs") AS avg_ms
    FROM "AIUsageLog" WHERE (${cond}) AND "createdAt" >= ${from} AND "createdAt" <= ${to}`;
  return { calls: n(r[0]?.calls), failed: n(r[0]?.failed), avgMs: r[0]?.avg_ms == null ? null : Number(r[0].avg_ms) };
}

/** Tentatives démarrées dans la période, terminées ou abandonnées (inactives depuis plus de ABANDON_AFTER_DAYS jours). Les tentatives encore récentes ne sont ni l'un ni l'autre. */
export async function attemptOutcomes(from: Date, to: Date) {
  const cut = new Date(Date.now() - ABANDON_AFTER_DAYS * 86_400_000);
  const r = await db.$queryRaw<{ started: bigint; completed: bigint; abandoned: bigint; running: bigint }[]>`
    SELECT count(*) AS started,
           count(*) FILTER (WHERE status IN ('GRADED','SUBMITTED')) AS completed,
           count(*) FILTER (WHERE status = 'IN_PROGRESS' AND "updatedAt" < ${cut}) AS abandoned,
           count(*) FILTER (WHERE status = 'IN_PROGRESS' AND "updatedAt" >= ${cut}) AS running
    FROM "ExerciseAttempt" WHERE "startedAt" >= ${from} AND "startedAt" <= ${to}`;
  const x = r[0];
  const completed = n(x?.completed);
  const abandoned = n(x?.abandoned);
  return { started: n(x?.started), completed, abandoned, running: n(x?.running), rate: ratio(abandoned, completed + abandoned) };
}

/** Recommandations de révision générées par Niala dans la période, et ce que les étudiants en ont fait (table d'origine : historique complet). */
async function recommendationStats(p: Period): Promise<RecommendationStats> {
  const r = await db.$queryRaw<{ shown: bigint; followed: bigint; dismissed: bigint; pending: bigint }[]>`
    SELECT count(*) AS shown,
           count(*) FILTER (WHERE status IN ('IN_PROGRESS', 'DONE')) AS followed,
           count(*) FILTER (WHERE status = 'DISMISSED') AS dismissed,
           count(*) FILTER (WHERE status = 'SUGGESTED') AS pending
    FROM "LearningRecommendation" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to}`;
  const x = r[0];
  return { shown: n(x?.shown), followed: n(x?.followed), dismissed: n(x?.dismissed), pending: n(x?.pending), followRate: ratio(n(x?.followed), n(x?.shown)) };
}

async function compute(p: Period): Promise<FeatureReport> {
  const activeRow = await db.$queryRaw<{ c: bigint }[]>`SELECT count(DISTINCT "actorKey") AS c FROM "AnalyticsEvent" WHERE type IN (${activeTypesSql}) AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to}`;
  const active = n(activeRow[0]?.c);

  const features: FeatureStats[] = await Promise.all(
    FEATURES.map(async (f) => {
      const [cur, prev, ai, outcomes] = await Promise.all([
        usage(f, p.from, p.to),
        usage(f, p.prevFrom, p.prevTo),
        aiStats(f.key, p.from, p.to),
        f.key === "exercise-solving" ? attemptOutcomes(p.from, p.to) : Promise.resolve(null),
      ]);
      const useAi = ai != null && ai.calls > 0;
      const errCount = useAi ? ai.failed : cur.failed;
      const errBase = useAi ? ai.calls : cur.uses;
      const stats: FeatureStats = {
        key: f.key,
        label: f.label,
        uniqueUsers: metric(cur.users, prev.users),
        uses: metric(cur.uses, prev.uses),
        frequency: cur.users ? round1(cur.uses / cur.users) : null,
        adoption: ratio(cur.users, active),
        abandonment: outcomes ? { started: outcomes.started, completed: outcomes.completed, abandoned: outcomes.abandoned, rate: outcomes.rate } : null,
        errors: { count: errCount, rate: ratio(errCount, errBase), source: useAi ? "IA" : "événements" },
        avgProcessingMs: useAi ? ai.avgMs : cur.avgMs,
        flags: [],
      };
      return stats;
    }),
  );

  const needsWork = features
    .map((feature) => {
      const reasons: string[] = [];
      if (feature.errors.rate != null && feature.errors.count >= 3 && feature.errors.rate >= 10) reasons.push(`${feature.errors.rate} % d'échecs (${feature.errors.count})`);
      if (feature.abandonment?.rate != null && feature.abandonment.completed + feature.abandonment.abandoned >= 5 && feature.abandonment.rate >= 50) reasons.push(`${feature.abandonment.rate} % d'abandon`);
      if (feature.uses.change != null && feature.uses.previous != null && feature.uses.previous >= 10 && feature.uses.change <= -30) reasons.push(`usage en baisse de ${Math.abs(feature.uses.change)} %`);
      if (feature.adoption != null && active >= 10 && feature.adoption < 10 && (feature.uses.value ?? 0) > 0) reasons.push(`adoption faible (${feature.adoption} %)`);
      feature.flags = reasons;
      return { feature, reasons };
    })
    .filter((x) => x.reasons.length);

  const popular = [...features].filter((f) => (f.uses.value ?? 0) > 0).sort((a, b) => (b.adoption ?? 0) - (a.adoption ?? 0) || (b.uses.value ?? 0) - (a.uses.value ?? 0)).slice(0, 3);

  const mods = await db.$queryRaw<{ module: string | null; opens: bigint; users: bigint }[]>`
    SELECT module, count(*) AS opens, count(DISTINCT "actorKey") AS users FROM "AnalyticsEvent"
    WHERE type = 'module.open' AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} AND module IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`;
  const modules = mods.filter((m) => isModule(m.module)).map((m) => ({ key: m.module!, label: MODULES[m.module as keyof typeof MODULES], opens: n(m.opens), users: n(m.users) }));

  return { period: p, recommendations: await recommendationStats(p), activeUsers: active, features, popular, needsWork, modules };
}

/** Fonctionnalités classées de la plus à la moins utilisée (par utilisations), pour la vue d'ensemble. */
export async function rankFeatures(p: Period) {
  const r = await getFeatureReport(p);
  const used = [...r.features].sort((a, b) => (b.uses.value ?? 0) - (a.uses.value ?? 0));
  return { most: used.slice(0, 3).filter((f) => (f.uses.value ?? 0) > 0), least: used.slice(-3).reverse() };
}
