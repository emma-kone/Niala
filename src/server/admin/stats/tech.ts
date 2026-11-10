import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import { getSetting } from "@/server/admin/settings";
import { bucketSql, cached, fillSeries, n, periodKey, ratio, round1, type Period } from "@/server/admin/stats/common";

// Supervision technique : mesurée sur les requêtes réelles de l'application (RequestLog) et sur les journaux d'IA.
// Aucun contenu de requête ni identifiant d'utilisateur n'est conservé dans ces journaux.

export interface TechReport {
  period: Period;
  module: string | null;
  requests: number;
  /** Part des requêtes sans erreur serveur (5xx). Mesure issue du trafic réel, pas d'une sonde externe. */
  availability: number | null;
  errorRate: number | null;
  serverErrors: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  byKind: { USER: number; APP: number; EXTERNAL: number };
  slowest: { route: string; method: string; count: number; avgMs: number; p95Ms: number }[];
  frequentErrors: { route: string; method: string; status: number; kind: string | null; count: number; last: Date }[];
  series: { bucket: Date; requests: number; errors: number; avgMs: number }[];
  pageLoad: { samples: number; avgMs: number | null; p75Ms: number | null };
  failures: { imports: number; generations: number; saves: number; auth: number; adminLogins: number };
  externalAi: { model: string; calls: number; avgMs: number | null; failed: number }[];
  modules: string[];
  notices: string[];
}

export function getTechReport(p: Period, module?: string | null): Promise<TechReport> {
  return cached(`tech:${periodKey(p)}:${module ?? ""}`, () => compute(p, module ?? null));
}

async function compute(p: Period, module: string | null): Promise<TechReport> {
  const mod = module ? { module } : {};
  const [agg, kinds, slowest, errors, series, pages, imports, gens, saves, auth, adminFails, ai, mods] = await Promise.all([
    db.$queryRaw<{ c: bigint; err5: bigint; err: bigint; avg: number | null; p50: number | null; p95: number | null }[]>`
      SELECT count(*) AS c, count(*) FILTER (WHERE status >= 500) AS err5, count(*) FILTER (WHERE status >= 400) AS err,
             avg("durationMs") AS avg, percentile_cont(0.5) WITHIN GROUP (ORDER BY "durationMs") AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95
      FROM "RequestLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} ${module ? sqlModule(module) : sqlNone()}`,
    db.requestLog.groupBy({ by: ["errorKind"], where: { createdAt: { gte: p.from, lte: p.to }, errorKind: { not: null }, ...mod }, _count: { _all: true } }),
    db.$queryRaw<{ route: string; method: string; c: bigint; avg: number; p95: number }[]>`
      SELECT route, method, count(*) AS c, avg("durationMs") AS avg, percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95
      FROM "RequestLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} ${module ? sqlModule(module) : sqlNone()}
      GROUP BY route, method HAVING count(*) >= 3 ORDER BY p95 DESC LIMIT 8`,
    db.$queryRaw<{ route: string; method: string; status: number; kind: string | null; c: bigint; last: Date }[]>`
      SELECT route, method, status, "errorKind" AS kind, count(*) AS c, max("createdAt") AS last
      FROM "RequestLog" WHERE status >= 400 AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} ${module ? sqlModule(module) : sqlNone()}
      GROUP BY 1, 2, 3, 4 ORDER BY c DESC LIMIT 10`,
    db.$queryRaw<{ bucket: Date; c: bigint; err: bigint; avg: number }[]>`
      SELECT ${bucketSql(p.bucket)} AS bucket, count(*) AS c, count(*) FILTER (WHERE status >= 500) AS err, avg("durationMs") AS avg
      FROM "RequestLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} ${module ? sqlModule(module) : sqlNone()} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ c: bigint; avg: number | null; p75: number | null }[]>`
      SELECT count(*) AS c, avg("durationMs") AS avg, percentile_cont(0.75) WITHIN GROUP (ORDER BY "durationMs") AS p75
      FROM "AnalyticsEvent" WHERE type = 'page.load' AND "durationMs" IS NOT NULL AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to}`,
    db.document.count({ where: { status: "ERROR", updatedAt: { gte: p.from, lte: p.to } } }),
    db.aIUsageLog.count({ where: { ok: false, op: { startsWith: "exercise.generate" }, createdAt: { gte: p.from, lte: p.to } } }),
    db.$queryRaw<{ c: bigint }[]>`
      SELECT count(*) AS c FROM "RequestLog" WHERE status >= 500 AND method IN ('PUT','PATCH','POST') AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to}
        AND (route LIKE '/api/notes%' OR route LIKE '/api/maps%' OR route LIKE '/api/attempts/%/answers%' OR route LIKE '/api/settings%' OR route LIKE '/api/profile%')`,
    db.$queryRaw<{ c: bigint }[]>`SELECT count(*) AS c FROM "RequestLog" WHERE route LIKE '/api/auth/%' AND status IN (401, 403) AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to}`,
    db.adminAuditLog.count({ where: { action: "admin.login_failed", createdAt: { gte: p.from, lte: p.to } } }),
    db.$queryRaw<{ model: string | null; c: bigint; avg: number | null; failed: bigint }[]>`
      SELECT model, count(*) AS c, avg("durationMs") FILTER (WHERE ok) AS avg, count(*) FILTER (WHERE ok = false) AS failed
      FROM "AIUsageLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ module: string | null }[]>`SELECT DISTINCT module FROM "RequestLog" WHERE "createdAt" >= ${new Date(Date.now() - 90 * 86_400_000)} AND module IS NOT NULL ORDER BY 1`,
  ]);

  const a = agg[0];
  const total = n(a?.c);
  const count = (k: string) => kinds.find((x) => x.errorKind === k)?._count._all ?? 0;
  return {
    period: p,
    module,
    requests: total,
    availability: total ? ratio(total - n(a?.err5), total) : null,
    errorRate: ratio(n(a?.err), total),
    serverErrors: n(a?.err5),
    avgMs: a?.avg == null ? null : Math.round(Number(a.avg)),
    p50Ms: a?.p50 == null ? null : Math.round(Number(a.p50)),
    p95Ms: a?.p95 == null ? null : Math.round(Number(a.p95)),
    byKind: { USER: count("USER"), APP: count("APP"), EXTERNAL: count("EXTERNAL") },
    slowest: slowest.map((r) => ({ route: r.route, method: r.method, count: n(r.c), avgMs: Math.round(Number(r.avg)), p95Ms: Math.round(Number(r.p95)) })),
    frequentErrors: errors.map((r) => ({ route: r.route, method: r.method, status: r.status, kind: r.kind, count: n(r.c), last: r.last })),
    series: fillSeries(series.map((r) => ({ bucket: r.bucket, requests: n(r.c), errors: n(r.err), avgMs: Math.round(Number(r.avg)) })), p, (bucket) => ({ bucket, requests: 0, errors: 0, avgMs: 0 })),
    pageLoad: { samples: n(pages[0]?.c), avgMs: pages[0]?.avg == null ? null : Math.round(Number(pages[0].avg)), p75Ms: pages[0]?.p75 == null ? null : Math.round(Number(pages[0].p75)) },
    failures: { imports, generations: gens, saves: n(saves[0]?.c), auth: n(auth[0]?.c), adminLogins: adminFails },
    externalAi: ai.map((r) => ({ model: r.model ?? "inconnu", calls: n(r.c), avgMs: r.avg == null ? null : Math.round(Number(r.avg)), failed: n(r.failed) })),
    modules: mods.map((m) => m.module!).filter(Boolean),
    notices: [
      "La disponibilité est calculée sur le trafic réel (requêtes sans erreur serveur). Elle ne détecte pas une panne totale survenue sans aucune requête : une sonde externe est nécessaire pour cela.",
      "Seul le temps de réponse du fournisseur d'IA est mesuré parmi les services externes ; le stockage de fichiers et la recherche web ne sont pas chronométrés.",
      "La collecte des requêtes d'API a démarré avec le back-office : il n'existe pas d'historique antérieur.",
    ],
  };
}

const sqlModule = (m: string) => Prisma.sql`AND module = ${m}`;
const sqlNone = () => Prisma.empty;

// ── Alertes et incidents ─────────────────────────────────────────────────────

interface Rule {
  key: string;
  evaluate: () => Promise<{ severity: "WARNING" | "CRITICAL"; title: string; detail: string } | null>;
}

const HOUR = 3_600_000;

const RULES: Rule[] = [
  {
    key: "errors.rate",
    async evaluate() {
      const since = new Date(Date.now() - HOUR);
      const r = await db.$queryRaw<{ c: bigint; e: bigint }[]>`SELECT count(*) AS c, count(*) FILTER (WHERE status >= 500) AS e FROM "RequestLog" WHERE "createdAt" >= ${since}`;
      const c = n(r[0]?.c);
      const e = n(r[0]?.e);
      const rate = c ? (e / c) * 100 : 0;
      if (c < 20 || rate < 5) return null;
      return { severity: rate >= 15 ? "CRITICAL" : "WARNING", title: "Taux d'erreurs serveur élevé", detail: `${e} erreurs serveur sur ${c} requêtes dans la dernière heure (${round1(rate)} %).` };
    },
  },
  {
    key: "latency.p95",
    async evaluate() {
      const since = new Date(Date.now() - HOUR);
      const r = await db.$queryRaw<{ c: bigint; p95: number | null }[]>`SELECT count(*) AS c, percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95 FROM "RequestLog" WHERE "createdAt" >= ${since} AND route NOT LIKE '/api/conversations%' AND route NOT LIKE '/api/exercises%'`;
      const p95 = Number(r[0]?.p95 ?? 0);
      if (n(r[0]?.c) < 20 || p95 < 5000) return null;
      return { severity: "WARNING", title: "Temps de réponse dégradés", detail: `95 % des requêtes (hors IA) répondent en moins de ${Math.round(p95)} ms sur la dernière heure.` };
    },
  },
  {
    key: "ai.failures",
    async evaluate() {
      const since = new Date(Date.now() - HOUR);
      const r = await db.$queryRaw<{ c: bigint; f: bigint }[]>`SELECT count(*) AS c, count(*) FILTER (WHERE ok = false) AS f FROM "AIUsageLog" WHERE "createdAt" >= ${since}`;
      const c = n(r[0]?.c);
      const f = n(r[0]?.f);
      const rate = c ? (f / c) * 100 : 0;
      if (c < 10 || rate < 15) return null;
      return { severity: rate >= 30 ? "CRITICAL" : "WARNING", title: "Échecs d'appels IA en hausse", detail: `${f} appels IA en échec sur ${c} dans la dernière heure (${round1(rate)} %).` };
    },
  },
  {
    key: "ai.volume",
    async evaluate() {
      const now = Date.now();
      const r = await db.$queryRaw<{ last: bigint; base: bigint }[]>`
        SELECT count(*) FILTER (WHERE "createdAt" >= ${new Date(now - HOUR)}) AS last,
               count(*) FILTER (WHERE "createdAt" < ${new Date(now - HOUR)}) AS base
        FROM "AIUsageLog" WHERE "createdAt" >= ${new Date(now - 7 * 24 * HOUR)}`;
      const last = n(r[0]?.last);
      const hourlyAvg = n(r[0]?.base) / (7 * 24 - 1);
      if (last < 30 || last < Math.max(3 * hourlyAvg, 30)) return null;
      return { severity: "WARNING", title: "Consommation d'IA anormalement élevée", detail: `${last} appels IA sur la dernière heure, contre ${round1(hourlyAvg)} par heure en moyenne sur 7 jours.` };
    },
  },
  {
    key: "security.admin-logins",
    async evaluate() {
      const since = new Date(Date.now() - 15 * 60_000);
      const failed = await db.adminAuditLog.count({ where: { action: "admin.login_failed", createdAt: { gte: since } } });
      if (failed < 5) return null;
      return { severity: "WARNING", title: "Tentatives de connexion administrateur échouées", detail: `${failed} échecs de connexion à l'espace d'administration en 15 minutes.` };
    },
  },
];

const lastEvaluation = { at: 0 };

/** Ouvre les alertes dont la règle est déclenchée et résout celles qui ne le sont plus. Au plus une évaluation par minute. */
export async function evaluateAlerts(force = false): Promise<void> {
  if (!force && Date.now() - lastEvaluation.at < 60_000) return;
  lastEvaluation.at = Date.now();
  if (!(await getSetting("alerts.enabled"))) return;
  for (const rule of RULES) {
    try {
      const hit = await rule.evaluate();
      const open = await db.adminAlert.findFirst({ where: { key: rule.key, status: "OPEN" } });
      if (hit && !open) await db.adminAlert.create({ data: { key: rule.key, severity: hit.severity, title: hit.title, detail: hit.detail } });
      else if (hit && open && (open.severity !== hit.severity || open.detail !== hit.detail)) await db.adminAlert.update({ where: { id: open.id }, data: { severity: hit.severity, detail: hit.detail } });
      else if (!hit && open) await db.adminAlert.update({ where: { id: open.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    } catch (e) {
      console.error(`[alertes] règle ${rule.key} :`, e instanceof Error ? e.message : e);
    }
  }
}

export async function listAlerts(limit = 30) {
  return db.adminAlert.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: limit });
}

export async function openAlertCount() {
  return db.adminAlert.count({ where: { status: "OPEN" } });
}

export async function resolveAlert(actor: { id: string; email: string }, id: string) {
  const alert = await db.adminAlert.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  await audit(actor, "alert.resolve", { targetType: "alert", targetId: id, detail: { key: alert.key } });
}
