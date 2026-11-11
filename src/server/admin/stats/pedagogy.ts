import { Prisma } from "@prisma/client";
// Statistiques : client non filtré, les contenus supprimés par les étudiants restent comptés.
import { dbAll as db } from "@/lib/db";
import { LAB_LABELS, SUCCESS_RATIO } from "@/server/analytics/definitions";
import { attemptOutcomes } from "@/server/admin/stats/features";
import { bucketSql, cached, fillSeries, metric, n, periodKey, ratio, round1, type Metric, type Period } from "@/server/admin/stats/common";

// Activité pédagogique : données AGRÉGÉES et anonymisées. Un libellé (matière, notion) n'est affiché que s'il est
// partagé par au moins MIN_USERS étudiants différents ; sinon il est regroupé sous « Autres » (pas de surveillance individuelle).

export const MIN_USERS = 3;
const DIFFICULTY_LEVEL: Record<string, number> = { facile: 1, moyenne: 2, difficile: 3 };

export interface Ranked { label: string; value: number; users?: number; change?: number | null; extra?: number | null }

export interface PedagogyReport {
  period: Period;
  exercises: {
    generated: Metric;
    started: Metric;
    completed: Metric;
    abandoned: Metric;
    /** Part des exercices terminés dont le score atteint SUCCESS_RATIO du barème. */
    successRate: Metric;
    /** 1 = facile, 2 = moyenne, 3 = difficile (moyenne des questions des exercices créés dans la période). */
    avgDifficulty: number | null;
    byOrigin: Ranked[];
    byType: Ranked[];
    byDifficulty: Ranked[];
  };
  subjects: { ranking: Ranked[]; others: number; hiddenSubjects: number };
  environments: { key: string; label: string; workspaces: number; users: number; runs: number; testedRuns: number; passedRuns: number; errors: number; errorRate: number | null }[];
  progress: {
    successBySubject: Ranked[];
    successSeries: { bucket: Date; value: number | null; count: number }[];
    topConcepts: Ranked[];
    difficulties: Ranked[];
    errorCategories: Ranked[];
    masteryNow: { concepts: number; avgLevel: number | null; users: number };
  };
  notices: string[];
}

export function getPedagogy(period: Period): Promise<PedagogyReport> {
  return cached(`pedagogy:${periodKey(period)}`, () => compute(period));
}

/** Nom de matière normalisé (casse et espaces) : « Algo » et « algo » comptent ensemble. */
const SUBJECT_EXPR = Prisma.sql`lower(btrim(coalesce(s.name, e.config->'free'->>'subject', '')))`;
const SUCCESS = Prisma.sql`(a."maxScore" > 0 AND a.score >= a."maxScore" * ${SUCCESS_RATIO})`;

async function compute(p: Period): Promise<PedagogyReport> {
  const [genCur, genPrev, outCur, outPrev, successCur, successPrev, diff, origin, types, difficulties, subjects, labs, bySubjectSuccess, series, concepts, hard, cats, mastery] = await Promise.all([
    db.exercise.count({ where: { createdAt: { gte: p.from, lte: p.to }, saved: true } }),
    db.exercise.count({ where: { createdAt: { gte: p.prevFrom, lte: p.prevTo }, saved: true } }),
    attemptOutcomes(p.from, p.to),
    attemptOutcomes(p.prevFrom, p.prevTo),
    successOf(p.from, p.to),
    successOf(p.prevFrom, p.prevTo),
    db.$queryRaw<{ avg: number | null }[]>`SELECT avg(CASE q.difficulty WHEN 'facile' THEN 1 WHEN 'moyenne' THEN 2 WHEN 'difficile' THEN 3 END) AS avg FROM "Question" q JOIN "Exercise" e ON e.id = q."exerciseId" WHERE e."createdAt" >= ${p.from} AND e."createdAt" <= ${p.to}`,
    db.$queryRaw<{ k: string; v: bigint }[]>`SELECT origin AS k, count(*) AS v FROM "Exercise" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ k: string; v: bigint }[]>`SELECT q.type AS k, count(*) AS v FROM "Question" q JOIN "Exercise" e ON e.id = q."exerciseId" WHERE e."createdAt" >= ${p.from} AND e."createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ k: string; v: bigint }[]>`SELECT q.difficulty AS k, count(*) AS v FROM "Question" q JOIN "Exercise" e ON e.id = q."exerciseId" WHERE e."createdAt" >= ${p.from} AND e."createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
    subjectRanking(p),
    labStats(p),
    successBySubject(p),
    successSeries(p),
    topConcepts(p),
    hardConcepts(p),
    db.$queryRaw<{ k: string; v: bigint }[]>`SELECT category::text AS k, count(*) AS v FROM "ErrorDiagnosis" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ c: bigint; avg: number | null; users: bigint }[]>`SELECT count(*) AS c, avg(level) AS avg, count(DISTINCT "userId") AS users FROM "ConceptMastery" WHERE "evidenceCount" > 0`,
  ]);

  const notices = [
    "Les noms de matières et de notions ne sont affichés que s'ils sont partagés par au moins " + MIN_USERS + " étudiants.",
    "Il n'existe pas d'historique de la maîtrise par notion : seule la maîtrise actuelle est affichée, la progression passe par l'évolution du taux de réussite.",
    "Niala ne propose que deux environnements pratiques (labo de code et labo SQL) : il n'y a pas d'atelier Merise, d'éditeur mathématique ni d'éditeur algorithmique à mesurer.",
  ];
  return {
    period: p,
    exercises: {
      generated: metric(genCur, genPrev),
      started: metric(outCur.started, outPrev.started),
      completed: metric(outCur.completed, outPrev.completed),
      abandoned: metric(outCur.abandoned, outPrev.abandoned),
      successRate: metric(successCur, successPrev),
      avgDifficulty: diff[0]?.avg == null ? null : round1(Number(diff[0].avg)),
      byOrigin: origin.map((r) => ({ label: r.k, value: n(r.v) })),
      byType: types.map((r) => ({ label: r.k, value: n(r.v) })),
      byDifficulty: difficulties.sort((a, b) => (DIFFICULTY_LEVEL[a.k] ?? 9) - (DIFFICULTY_LEVEL[b.k] ?? 9)).map((r) => ({ label: r.k, value: n(r.v) })),
    },
    subjects,
    environments: labs,
    progress: { successBySubject: bySubjectSuccess, successSeries: series, topConcepts: concepts, difficulties: hard, errorCategories: cats.map((r) => ({ label: r.k, value: n(r.v) })), masteryNow: { concepts: n(mastery[0]?.c), avgLevel: mastery[0]?.avg == null ? null : round1(Number(mastery[0].avg) * 100), users: n(mastery[0]?.users) } },
    notices,
  };
}

async function successOf(from: Date, to: Date): Promise<number | null> {
  const r = await db.$queryRaw<{ done: bigint; ok: bigint }[]>`
    SELECT count(*) AS done, count(*) FILTER (WHERE ${SUCCESS}) AS ok FROM "ExerciseAttempt" a
    WHERE a.status IN ('GRADED','SUBMITTED') AND a."finishedAt" >= ${from} AND a."finishedAt" <= ${to}`;
  return ratio(n(r[0]?.ok), n(r[0]?.done));
}

const titleCase = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

async function subjectRanking(p: Period) {
  const rows = await db.$queryRaw<{ k: string; v: bigint; u: bigint; prev: bigint }[]>`
    SELECT ${SUBJECT_EXPR} AS k,
           count(*) FILTER (WHERE a."startedAt" >= ${p.from} AND a."startedAt" <= ${p.to}) AS v,
           count(DISTINCT a."userId") FILTER (WHERE a."startedAt" >= ${p.from} AND a."startedAt" <= ${p.to}) AS u,
           count(*) FILTER (WHERE a."startedAt" >= ${p.prevFrom} AND a."startedAt" <= ${p.prevTo}) AS prev
    FROM "ExerciseAttempt" a JOIN "Exercise" e ON e.id = a."exerciseId" LEFT JOIN "Subject" s ON s.id = e."subjectId"
    WHERE a."startedAt" >= ${p.prevFrom} AND a."startedAt" <= ${p.to}
    GROUP BY 1 HAVING count(*) FILTER (WHERE a."startedAt" >= ${p.from} AND a."startedAt" <= ${p.to}) > 0 ORDER BY 2 DESC`;
  const shown = rows.filter((r) => r.k && n(r.u) >= MIN_USERS);
  const hidden = rows.filter((r) => !r.k || n(r.u) < MIN_USERS);
  return {
    ranking: shown.slice(0, 15).map((r) => ({ label: titleCase(r.k), value: n(r.v), users: n(r.u), change: n(r.prev) > 0 ? round1(((n(r.v) - n(r.prev)) / n(r.prev)) * 100) : null })),
    others: hidden.reduce((s, r) => s + n(r.v), 0),
    hiddenSubjects: hidden.length,
  };
}

async function successBySubject(p: Period): Promise<Ranked[]> {
  const rows = await db.$queryRaw<{ k: string; done: bigint; ok: bigint; u: bigint }[]>`
    SELECT ${SUBJECT_EXPR} AS k, count(*) AS done, count(*) FILTER (WHERE ${SUCCESS}) AS ok, count(DISTINCT a."userId") AS u
    FROM "ExerciseAttempt" a JOIN "Exercise" e ON e.id = a."exerciseId" LEFT JOIN "Subject" s ON s.id = e."subjectId"
    WHERE a.status IN ('GRADED','SUBMITTED') AND a."finishedAt" >= ${p.from} AND a."finishedAt" <= ${p.to}
    GROUP BY 1 HAVING count(DISTINCT a."userId") >= ${MIN_USERS} ORDER BY 2 DESC LIMIT 12`;
  return rows.filter((r) => r.k).map((r) => ({ label: titleCase(r.k), value: ratio(n(r.ok), n(r.done)) ?? 0, users: n(r.u), extra: n(r.done) }));
}

async function successSeries(p: Period) {
  const rows = await db.$queryRaw<{ bucket: Date; done: bigint; ok: bigint }[]>`
    SELECT ${bucketSql(p.bucket, Prisma.raw('a."finishedAt"'))} AS bucket, count(*) AS done, count(*) FILTER (WHERE ${SUCCESS}) AS ok
    FROM "ExerciseAttempt" a WHERE a.status IN ('GRADED','SUBMITTED') AND a."finishedAt" >= ${p.from} AND a."finishedAt" <= ${p.to} GROUP BY 1 ORDER BY 1`;
  return fillSeries(rows.map((r) => ({ bucket: r.bucket, value: ratio(n(r.ok), n(r.done)), count: n(r.done) })), p, (bucket) => ({ bucket, value: null as number | null, count: 0 }));
}

/** Notions les plus travaillées : questions rencontrées dans les tentatives de la période. */
async function topConcepts(p: Period): Promise<Ranked[]> {
  const rows = await db.$queryRaw<{ k: string; v: bigint; u: bigint }[]>`
    SELECT lower(btrim(c.name)) AS k, count(*) AS v, count(DISTINCT a."userId") AS u
    FROM "Answer" an JOIN "ExerciseAttempt" a ON a.id = an."attemptId"
    JOIN "Question" q ON q."exerciseId" = a."exerciseId" AND q.position = an.position
    JOIN "QuestionConcept" qc ON qc."questionId" = q.id JOIN "Concept" c ON c.id = qc."conceptId"
    WHERE an."updatedAt" >= ${p.from} AND an."updatedAt" <= ${p.to}
    GROUP BY 1 HAVING count(DISTINCT a."userId") >= ${MIN_USERS} ORDER BY 2 DESC LIMIT 10`;
  return rows.map((r) => ({ label: titleCase(r.k), value: n(r.v), users: n(r.u) }));
}

/** Notions où le taux d'erreur est le plus élevé (au moins MIN_USERS étudiants et 10 réponses). */
async function hardConcepts(p: Period): Promise<Ranked[]> {
  const rows = await db.$queryRaw<{ k: string; v: bigint; bad: bigint; u: bigint }[]>`
    SELECT lower(btrim(c.name)) AS k, count(*) AS v, count(*) FILTER (WHERE an.verdict = 'incorrect') AS bad, count(DISTINCT a."userId") AS u
    FROM "Answer" an JOIN "ExerciseAttempt" a ON a.id = an."attemptId"
    JOIN "Question" q ON q."exerciseId" = a."exerciseId" AND q.position = an.position
    JOIN "QuestionConcept" qc ON qc."questionId" = q.id JOIN "Concept" c ON c.id = qc."conceptId"
    WHERE an.verdict IS NOT NULL AND an."updatedAt" >= ${p.from} AND an."updatedAt" <= ${p.to}
    GROUP BY 1 HAVING count(DISTINCT a."userId") >= ${MIN_USERS} AND count(*) >= 10 ORDER BY (count(*) FILTER (WHERE an.verdict = 'incorrect'))::float / count(*) DESC LIMIT 8`;
  return rows.map((r) => ({ label: titleCase(r.k), value: ratio(n(r.bad), n(r.v)) ?? 0, users: n(r.u), extra: n(r.v) }));
}

async function labStats(p: Period) {
  const [ws, runs] = await Promise.all([
    db.$queryRaw<{ kind: string; w: bigint; u: bigint }[]>`SELECT kind::text AS kind, count(*) AS w, count(DISTINCT "userId") AS u FROM "LabWorkspace" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1`,
    db.$queryRaw<{ kind: string; r: bigint; u: bigint; tested: bigint; passed: bigint; err: bigint }[]>`
      SELECT w.kind::text AS kind, count(*) AS r, count(DISTINCT r."userId") AS u,
             count(*) FILTER (WHERE r.tests IS NOT NULL) AS tested,
             count(*) FILTER (WHERE r.tests->'summary'->>'allPassed' = 'true') AS passed,
             count(*) FILTER (WHERE r.output->>'status' IN ('error','timeout') OR (r.output->>'error') IS NOT NULL) AS err
      FROM "LabRun" r JOIN "LabWorkspace" w ON w.id = r."workspaceId"
      WHERE r."createdAt" >= ${p.from} AND r."createdAt" <= ${p.to} GROUP BY 1`,
  ]);
  return (["CODE", "SQL"] as const).map((kind) => {
    const w = ws.find((x) => x.kind === kind);
    const r = runs.find((x) => x.kind === kind);
    return { key: kind, label: LAB_LABELS[kind], workspaces: n(w?.w), users: Math.max(n(w?.u), n(r?.u)), runs: n(r?.r), testedRuns: n(r?.tested), passedRuns: n(r?.passed), errors: n(r?.err), errorRate: ratio(n(r?.err), n(r?.r)) };
  });
}

