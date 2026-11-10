import { db } from "@/lib/db";
import { bucketSql, cached, fillSeries, metric, n, periodKey, ratio, type Metric, type Period } from "@/server/admin/stats/common";

// Supervision de l'IA : lue dans AIUsageLog (une ligne par appel au fournisseur). Aucune clé, aucun prompt, aucune réponse.

export const AI_FEATURES: { key: string; label: string; group: "generation" | "analysis" | "assistance" | "other"; prefixes: string[] }[] = [
  { key: "generation", label: "Génération d'exercices", group: "generation", prefixes: ["exercise.generate"] },
  { key: "exercise-import", label: "Importation d'exercices", group: "other", prefixes: ["exercise.import"] },
  { key: "analysis", label: "Analyse de documents", group: "analysis", prefixes: ["analysis."] },
  { key: "grading", label: "Correction des réponses", group: "assistance", prefixes: ["answer.evaluate", "attempt.review"] },
  { key: "tutor", label: "Tuteur d'exercice", group: "assistance", prefixes: ["exercise.tutor"] },
  { key: "assistant", label: "Assistant IA (conversation)", group: "assistance", prefixes: ["chat.turn"] },
  { key: "lab", label: "Assistance des labos", group: "assistance", prefixes: ["lab."] },
  { key: "index", label: "Indexation des cours", group: "other", prefixes: ["index.embed"] },
  { key: "verify", label: "Vérification des sources", group: "other", prefixes: ["reliability."] },
  { key: "agenda", label: "Import d'emploi du temps", group: "other", prefixes: ["agenda."] },
];

export const featureOfOp = (op: string) => AI_FEATURES.find((f) => f.prefixes.some((p) => op.startsWith(p))) ?? { key: "other", label: "Autres opérations", group: "other" as const, prefixes: [] };

export interface AiReport {
  period: Period;
  calls: Metric;
  ok: number;
  failed: number;
  failureRate: number | null;
  avgMs: number | null;
  p95Ms: number | null;
  generations: number;
  documentAnalyses: number;
  assistances: number;
  byFeature: { key: string; label: string; calls: number; failed: number; avgMs: number | null; chars: number; share: number | null }[];
  byModel: { model: string; calls: number; failed: number; avgMs: number | null }[];
  series: { bucket: Date; calls: number; failed: number }[];
  chars: { prompt: number; response: number };
  topErrors: { message: string; count: number; feature: string }[];
  /** Ce que le fournisseur ne remonte pas : affiché tel quel pour ne rien laisser supposer. */
  unavailable: string[];
}

export function getAiReport(p: Period): Promise<AiReport> {
  return cached(`ai:${periodKey(p)}`, () => compute(p));
}

async function compute(p: Period): Promise<AiReport> {
  const [tot, prev, byOp, byModel, series, errors] = await Promise.all([
    db.$queryRaw<{ c: bigint; failed: bigint; avg: number | null; p95: number | null; pc: bigint; rc: bigint }[]>`
      SELECT count(*) AS c, count(*) FILTER (WHERE ok = false) AS failed, avg("durationMs") FILTER (WHERE ok) AS avg,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") FILTER (WHERE ok) AS p95,
             coalesce(sum("promptChars"), 0) AS pc, coalesce(sum("respChars"), 0) AS rc
      FROM "AIUsageLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to}`,
    db.aIUsageLog.count({ where: { createdAt: { gte: p.prevFrom, lte: p.prevTo } } }),
    db.$queryRaw<{ op: string; c: bigint; failed: bigint; avg: number | null; chars: bigint }[]>`
      SELECT split_part(op, '@', 1) AS op, count(*) AS c, count(*) FILTER (WHERE ok = false) AS failed, avg("durationMs") FILTER (WHERE ok) AS avg,
             coalesce(sum(coalesce("promptChars", 0) + coalesce("respChars", 0)), 0) AS chars
      FROM "AIUsageLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1`,
    db.$queryRaw<{ model: string | null; c: bigint; failed: bigint; avg: number | null }[]>`
      SELECT model, count(*) AS c, count(*) FILTER (WHERE ok = false) AS failed, avg("durationMs") FILTER (WHERE ok) AS avg
      FROM "AIUsageLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ bucket: Date; c: bigint; failed: bigint }[]>`
      SELECT ${bucketSql(p.bucket)} AS bucket, count(*) AS c, count(*) FILTER (WHERE ok = false) AS failed
      FROM "AIUsageLog" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ op: string; e: string | null; c: bigint }[]>`
      SELECT split_part(op, '@', 1) AS op, left(error, 120) AS e, count(*) AS c FROM "AIUsageLog"
      WHERE ok = false AND "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8`,
  ]);

  const t = tot[0];
  const total = n(t?.c);
  const failed = n(t?.failed);

  const features = new Map<string, { key: string; label: string; calls: number; failed: number; ms: number; msN: number; chars: number }>();
  let generations = 0;
  let analyses = 0;
  let assists = 0;
  for (const r of byOp) {
    const f = featureOfOp(r.op);
    const cur = features.get(f.key) ?? { key: f.key, label: f.label, calls: 0, failed: 0, ms: 0, msN: 0, chars: 0 };
    cur.calls += n(r.c);
    cur.failed += n(r.failed);
    cur.chars += n(r.chars);
    if (r.avg != null) {
      cur.ms += Number(r.avg) * (n(r.c) - n(r.failed));
      cur.msN += n(r.c) - n(r.failed);
    }
    features.set(f.key, cur);
    if (f.group === "generation") generations += n(r.c);
    if (f.group === "analysis") analyses += n(r.c);
    if (f.group === "assistance") assists += n(r.c);
  }

  return {
    period: p,
    calls: metric(total, prev),
    ok: total - failed,
    failed,
    failureRate: ratio(failed, total),
    avgMs: t?.avg == null ? null : Math.round(Number(t.avg)),
    p95Ms: t?.p95 == null ? null : Math.round(Number(t.p95)),
    generations,
    documentAnalyses: analyses,
    assistances: assists,
    byFeature: [...features.values()].sort((a, b) => b.calls - a.calls).map((f) => ({ key: f.key, label: f.label, calls: f.calls, failed: f.failed, avgMs: f.msN ? Math.round(f.ms / f.msN) : null, chars: f.chars, share: ratio(f.calls, total) })),
    byModel: byModel.map((m) => ({ model: m.model ?? "inconnu", calls: n(m.c), failed: n(m.failed), avgMs: m.avg == null ? null : Math.round(Number(m.avg)) })),
    series: fillSeries(series.map((r) => ({ bucket: r.bucket, calls: n(r.c), failed: n(r.failed) })), p, (bucket) => ({ bucket, calls: 0, failed: 0 })),
    chars: { prompt: n(t?.pc), response: n(t?.rc) },
    topErrors: errors.map((e) => ({ message: e.e ?? "Erreur sans message", count: n(e.c), feature: featureOfOp(e.op).label })),
    unavailable: [
      "Volume de jetons (tokens) : le fournisseur n'est pas interrogé pour ce chiffre, donc non collecté. Le volume est mesuré en caractères envoyés et reçus.",
      "Coût estimé : non calculable sans le nombre de jetons et le tarif du modèle ; aucun montant n'est affiché plutôt qu'un montant inventé.",
    ],
  };
}

