import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import { ForbiddenError, type AdminUser } from "@/server/admin/session";
import { can } from "@/server/admin/rbac";
import { activeTypesSql, ensureActorKeys, n, ratio, round1, SESSION_GAP_SQL } from "@/server/admin/stats/common";
import { SESSION_GAP_MIN, SUCCESS_RATIO, categoryLabel } from "@/server/analytics/definitions";
import { purgeAccount } from "@/server/services/profile";
import { forgetCategory } from "@/server/analytics/track";

// Gestion des utilisateurs : liste filtrable, fiche détaillée (sans contenu de travail ni conversations) et actions auditées.

export const PAGE_SIZE = 25;

export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.enum(["ESATIC", "OTHER_SCHOOL", "TESTER", "NONE"]).optional(),
  institution: z.string().trim().max(120).optional(),
  field: z.string().trim().max(120).optional(),
  level: z.string().trim().max(20).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]).optional(),
  activity: z.enum(["active7", "active30", "inactive30", "never"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(["name", "email", "category", "institution", "field", "level", "createdAt", "lastActivity", "sessions", "exercises", "status"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type UserListQuery = z.infer<typeof listQuerySchema>;

export interface UserRow {
  id: string;
  name: string | null;
  email: string;
  category: string | null;
  categoryLabel: string;
  institution: string | null;
  field: string | null;
  level: string | null;
  createdAt: Date;
  lastActivity: Date | null;
  sessions: number | null;
  exercises: number | null;
  status: string;
}

const SORTS: Record<string, string> = {
  name: 'lower(u.name)',
  email: 'lower(u.email)',
  category: "coalesce(p.category, 'ZZ')",
  institution: "lower(coalesce(p.institution, ''))",
  field: "lower(coalesce(p.field, ''))",
  level: "coalesce(p.level, '')",
  createdAt: 'u."createdAt"',
  lastActivity: 'la.last',
  sessions: 'coalesce(st.sessions, 0)',
  exercises: 'coalesce(ex.done, 0)',
  status: 'u."accountStatus"',
};

export async function listUsers(admin: AdminUser, raw: unknown) {
  const q = listQuerySchema.parse(raw);
  const full = can(admin.role, "users.view");
  if (!full && ["lastActivity", "sessions", "exercises"].includes(q.sort)) q.sort = "createdAt";
  await ensureActorKeys();

  const where: Prisma.Sql[] = [Prisma.sql`u."adminRole" IS NULL`];
  if (q.q) {
    const like = `%${q.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(Prisma.sql`(lower(u.email) LIKE ${like} OR lower(coalesce(u.name, '')) LIKE ${like})`);
  }
  if (q.category) where.push(q.category === "NONE" ? Prisma.sql`p.category IS NULL` : Prisma.sql`p.category = ${q.category}`);
  if (q.institution) where.push(Prisma.sql`p.institution = ${q.institution}`);
  if (q.field) where.push(Prisma.sql`p.field = ${q.field}`);
  if (q.level) where.push(Prisma.sql`p.level = ${q.level}`);
  if (q.status) where.push(Prisma.sql`u."accountStatus" = ${q.status}`);
  if (q.from) where.push(Prisma.sql`u."createdAt" >= ${new Date(`${q.from}T00:00:00.000Z`)}`);
  if (q.to) where.push(Prisma.sql`u."createdAt" < ${new Date(new Date(`${q.to}T00:00:00.000Z`).getTime() + 86_400_000)}`);
  const day = 86_400_000;
  if (full && q.activity === "active7") where.push(Prisma.sql`la.last >= ${new Date(Date.now() - 7 * day)}`);
  if (full && q.activity === "active30") where.push(Prisma.sql`la.last >= ${new Date(Date.now() - 30 * day)}`);
  if (full && q.activity === "inactive30") where.push(Prisma.sql`(la.last IS NULL OR la.last < ${new Date(Date.now() - 30 * day)}) AND u."createdAt" < ${new Date(Date.now() - 30 * day)}`);
  if (full && q.activity === "never") where.push(Prisma.sql`la.last IS NULL`);

  const order = Prisma.raw(`${SORTS[q.sort]} ${q.dir === "asc" ? "ASC" : "DESC"} NULLS LAST, u.id`);
  const rows = await db.$queryRaw<(Omit<UserRow, "categoryLabel" | "sessions" | "exercises"> & { sessions: bigint | null; exercises: bigint | null; total: bigint })[]>`
    WITH ev AS (
      SELECT "actorKey", CASE WHEN lag("createdAt") OVER w IS NULL OR "createdAt" - lag("createdAt") OVER w > interval '${SESSION_GAP_SQL}' THEN 1 ELSE 0 END AS starts
      FROM "AnalyticsEvent" WHERE source = 'LIVE' AND type <> 'page.load' WINDOW w AS (PARTITION BY "actorKey" ORDER BY "createdAt")),
    st AS (SELECT "actorKey", sum(starts) AS sessions FROM ev GROUP BY 1),
    la AS (SELECT "actorKey", max("createdAt") AS last FROM "AnalyticsEvent" WHERE type IN (${activeTypesSql}) GROUP BY 1),
    ex AS (SELECT "userId", count(*) AS done FROM "ExerciseAttempt" WHERE status IN ('GRADED','SUBMITTED') GROUP BY 1)
    SELECT u.id, u.name, u.email, p.category, p.institution, p.field, p.level, u."createdAt", u."accountStatus" AS status,
           la.last AS "lastActivity", st.sessions AS sessions, coalesce(ex.done, 0) AS exercises, count(*) OVER () AS total
    FROM "User" u LEFT JOIN "StudentProfile" p ON p."userId" = u.id
    LEFT JOIN st ON st."actorKey" = u."actorKey" LEFT JOIN la ON la."actorKey" = u."actorKey" LEFT JOIN ex ON ex."userId" = u.id
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${(q.page - 1) * PAGE_SIZE}`;

  const total = rows.length ? n(rows[0].total) : 0;
  const data: UserRow[] = rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, category: r.category, categoryLabel: categoryLabel(r.category), institution: r.institution, field: r.field, level: r.level,
    createdAt: r.createdAt, status: r.status,
    lastActivity: full ? r.lastActivity : null,
    sessions: full ? n(r.sessions) : null,
    exercises: full ? n(r.exercises) : null,
  }));
  return { rows: data, total, page: q.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), query: q, full };
}

/** Valeurs proposées par les filtres (établissements, filières, niveaux réellement présents). */
export async function userFilterOptions() {
  const [institutions, fields, levels] = await Promise.all([
    db.studentProfile.findMany({ where: { institution: { not: null } }, select: { institution: true }, distinct: ["institution"], orderBy: { institution: "asc" }, take: 200 }),
    db.studentProfile.findMany({ where: { field: { not: null } }, select: { field: true }, distinct: ["field"], orderBy: { field: "asc" }, take: 200 }),
    db.studentProfile.findMany({ where: { level: { not: null } }, select: { level: true }, distinct: ["level"], orderBy: { level: "asc" }, take: 50 }),
  ]);
  return { institutions: institutions.map((i) => i.institution!), fields: fields.map((f) => f.field!), levels: levels.map((l) => l.level!) };
}

// ── Fiche détaillée ──────────────────────────────────────────────────────────

export async function getUserDetail(admin: AdminUser, id: string) {
  const full = can(admin.role, "users.view");
  const user = await db.user.findUnique({ where: { id }, include: { profile: { select: { category: true, institution: true, field: true, className: true, level: true, levelOther: true, situation: true } } } });
  if (!user || user.adminRole) throw new ApiHttpError("Utilisateur introuvable.", 404);
  await ensureActorKeys();
  const actorKey = (await db.user.findUnique({ where: { id }, select: { actorKey: true } }))?.actorKey ?? "";
  await audit(admin, "user.view", { targetType: "user", targetId: id, detail: { scope: full ? "full" : "support" } });

  const info = {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    category: user.profile?.category ?? null,
    categoryLabel: categoryLabel(user.profile?.category),
    institution: user.profile?.institution ?? null,
    field: user.profile?.field ?? null,
    className: user.profile?.className ?? null,
    level: user.profile?.level ? (user.profile.levelOther ? `${user.profile.level} — ${user.profile.levelOther}` : user.profile.level) : null,
    status: user.accountStatus,
    statusReason: user.statusReason,
    statusChangedAt: user.statusChangedAt,
    signIn: user.passwordHash.startsWith("scrypt$") ? (user.googleSub ? "Mot de passe + Google" : "Mot de passe") : "Google",
  };

  const requests = await db.supportRequest.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, reference: true, subject: true, status: true, type: true, createdAt: true } });
  const history = await db.adminAuditLog.findMany({ where: { targetType: "user", targetId: id, action: { not: "user.view" } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, action: true, actorEmail: true, result: true, detail: true, createdAt: true } });
  if (!full) return { info, requests, history, activity: null, pedagogy: null, progress: null, full };

  const [lastLogin, ev, sessionsRows, activeDays] = await Promise.all([
    db.analyticsEvent.findFirst({ where: { actorKey, type: "auth.login" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.analyticsEvent.findMany({ where: { actorKey, type: { not: "page.load" } }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, type: true, module: true, ok: true, createdAt: true, source: true } }),
    db.$queryRaw<{ sessions: bigint; seconds: number | null }[]>`
      WITH ev AS (
        SELECT "createdAt", CASE WHEN lag("createdAt") OVER w IS NULL OR "createdAt" - lag("createdAt") OVER w > interval '${SESSION_GAP_SQL}' THEN 1 ELSE 0 END AS starts
        FROM "AnalyticsEvent" WHERE "actorKey" = ${actorKey} AND source = 'LIVE' AND type <> 'page.load' WINDOW w AS (ORDER BY "createdAt")),
      numbered AS (SELECT *, sum(starts) OVER (ORDER BY "createdAt") AS sid FROM ev),
      s AS (SELECT sid, extract(epoch FROM (max("createdAt") - min("createdAt"))) AS seconds FROM numbered GROUP BY sid)
      SELECT count(*) AS sessions, sum(seconds) AS seconds FROM s`,
    db.$queryRaw<{ days: bigint; first: Date | null }[]>`SELECT count(DISTINCT date_trunc('day', "createdAt")) AS days, min("createdAt") AS first FROM "AnalyticsEvent" WHERE "actorKey" = ${actorKey} AND type IN (${activeTypesSql})`,
  ]);
  const sessions = n(sessionsRows[0]?.sessions);
  const daysActive = n(activeDays[0]?.days);
  const sinceSignup = Math.max(1, Math.ceil((Date.now() - user.createdAt.getTime()) / 86_400_000));

  const [attempts, subjects, courses, docs, maps, labs, runs, diagnoses, concepts, weak] = await Promise.all([
    db.$queryRaw<{ done: bigint; ok: bigint; fail: bigint; open: bigint }[]>`
      SELECT count(*) FILTER (WHERE status IN ('GRADED','SUBMITTED')) AS done,
             count(*) FILTER (WHERE status IN ('GRADED','SUBMITTED') AND "maxScore" > 0 AND score >= "maxScore" * ${SUCCESS_RATIO}) AS ok,
             count(*) FILTER (WHERE status IN ('GRADED','SUBMITTED') AND ("maxScore" IS NULL OR "maxScore" = 0 OR score < "maxScore" * ${SUCCESS_RATIO})) AS fail,
             count(*) FILTER (WHERE status = 'IN_PROGRESS') AS open
      FROM "ExerciseAttempt" WHERE "userId" = ${id}`,
    db.$queryRaw<{ name: string; exercises: bigint; done: bigint; ok: bigint }[]>`
      SELECT coalesce(s.name, e.config->'free'->>'subject', 'Sans matière') AS name, count(DISTINCT e.id) AS exercises,
             count(a.id) FILTER (WHERE a.status IN ('GRADED','SUBMITTED')) AS done,
             count(a.id) FILTER (WHERE a.status IN ('GRADED','SUBMITTED') AND a."maxScore" > 0 AND a.score >= a."maxScore" * ${SUCCESS_RATIO}) AS ok
      FROM "Exercise" e LEFT JOIN "Subject" s ON s.id = e."subjectId" LEFT JOIN "ExerciseAttempt" a ON a."exerciseId" = e.id
      WHERE e."userId" = ${id} GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
    db.analyticsEvent.count({ where: { actorKey, type: "course.view" } }),
    db.document.count({ where: { userId: id } }),
    db.mindMap.count({ where: { userId: id } }),
    db.$queryRaw<{ kind: string; c: bigint }[]>`SELECT kind::text AS kind, count(*) AS c FROM "LabWorkspace" WHERE "userId" = ${id} GROUP BY 1`,
    db.$queryRaw<{ kind: string; c: bigint }[]>`SELECT w.kind::text AS kind, count(*) AS c FROM "LabRun" r JOIN "LabWorkspace" w ON w.id = r."workspaceId" WHERE r."userId" = ${id} GROUP BY 1`,
    db.$queryRaw<{ k: string; c: bigint }[]>`SELECT category::text AS k, count(*) AS c FROM "ErrorDiagnosis" WHERE "userId" = ${id} GROUP BY 1 ORDER BY 2 DESC`,
    db.$queryRaw<{ name: string; c: bigint }[]>`
      SELECT c.name, count(*) AS c FROM "Answer" an JOIN "ExerciseAttempt" a ON a.id = an."attemptId"
      JOIN "Question" q ON q."exerciseId" = a."exerciseId" AND q.position = an.position
      JOIN "QuestionConcept" qc ON qc."questionId" = q.id JOIN "Concept" c ON c.id = qc."conceptId"
      WHERE an."userId" = ${id} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    db.$queryRaw<{ name: string; bad: bigint; c: bigint }[]>`
      SELECT c.name, count(*) FILTER (WHERE an.verdict = 'incorrect') AS bad, count(*) AS c FROM "Answer" an JOIN "ExerciseAttempt" a ON a.id = an."attemptId"
      JOIN "Question" q ON q."exerciseId" = a."exerciseId" AND q.position = an.position
      JOIN "QuestionConcept" qc ON qc."questionId" = q.id JOIN "Concept" c ON c.id = qc."conceptId"
      WHERE an."userId" = ${id} AND an.verdict IS NOT NULL GROUP BY 1 HAVING count(*) >= 3 AND count(*) FILTER (WHERE an.verdict = 'incorrect') * 2 >= count(*) ORDER BY 2 DESC LIMIT 6`,
  ]);
  const results = await db.exerciseAttempt.findMany({ where: { userId: id, status: { in: ["GRADED", "SUBMITTED"] }, maxScore: { gt: 0 } }, orderBy: { finishedAt: "desc" }, take: 20, select: { finishedAt: true, score: true, maxScore: true } });
  const a0 = attempts[0];

  return {
    info, requests, history, full,
    activity: {
      lastLogin: lastLogin?.createdAt ?? null,
      sessions,
      daysActive,
      activeDaysShare: ratio(daysActive, sinceSignup),
      estimatedMinutes: sessionsRows[0]?.seconds == null ? null : Math.round(Number(sessionsRows[0].seconds) / 60),
      firstActivity: activeDays[0]?.first ?? null,
      events: ev,
      sessionRule: `Une session se termine après ${SESSION_GAP_MIN} minutes d'inactivité ; le temps d'utilisation est estimé à partir des événements collectés en direct.`,
    },
    pedagogy: {
      subjects: subjects.map((s) => ({ name: s.name, exercises: n(s.exercises), done: n(s.done), successRate: ratio(n(s.ok), n(s.done)) })),
      exercisesDone: n(a0?.done), exercisesPassed: n(a0?.ok), exercisesFailed: n(a0?.fail), exercisesOpen: n(a0?.open),
      coursesViewed: courses, documentsImported: docs, mapsCreated: maps,
      environments: (["CODE", "SQL"] as const).map((k) => ({ kind: k, workspaces: n(labs.find((l) => l.kind === k)?.c), runs: n(runs.find((l) => l.kind === k)?.c) })),
    },
    progress: {
      results: results.reverse().map((r) => ({ at: r.finishedAt, percent: round1(((r.score ?? 0) / (r.maxScore ?? 1)) * 100) ?? 0 })),
      skills: concepts.map((c) => ({ name: c.name, answers: n(c.c) })),
      difficulties: weak.map((w) => ({ name: w.name, errorRate: ratio(n(w.bad), n(w.c)) ?? 0, answers: n(w.c) })),
      errorCategories: diagnoses.map((d) => ({ category: d.k, count: n(d.c) })),
    },
  };
}

// ── Actions administratives ──────────────────────────────────────────────────

async function targetUser(admin: AdminUser, id: string) {
  if (id === admin.id) throw new ForbiddenError("Vous ne pouvez pas agir sur votre propre compte depuis le back-office.");
  const user = await db.user.findUnique({ where: { id }, include: { profile: true } });
  if (!user) throw new ApiHttpError("Utilisateur introuvable.", 404);
  if (user.adminRole) throw new ForbiddenError("Les comptes d'administration se gèrent depuis les paramètres d'administration.");
  return user;
}

export const statusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]),
  reason: z.string().trim().max(300).optional(),
});

const STATUS_ACTION = { ACTIVE: "user.reactivate", SUSPENDED: "user.suspend", DISABLED: "user.disable" } as const;

/** Suspend, désactive ou réactive un compte. Suspendre ou désactiver ferme immédiatement toutes les sessions ouvertes. */
export async function setAccountStatus(admin: AdminUser, id: string, raw: unknown) {
  const { status, reason } = statusSchema.parse(raw);
  const user = await targetUser(admin, id);
  if (user.accountStatus === status) throw new ApiHttpError("Le compte est déjà dans cet état.", 409);
  if (status !== "ACTIVE" && !reason) throw new ApiHttpError("Indiquez le motif (visible uniquement par l'administration).", 422);
  await db.user.update({
    where: { id },
    data: { accountStatus: status, statusReason: status === "ACTIVE" ? null : reason, statusChangedAt: new Date(), ...(status === "ACTIVE" ? {} : { sessionVersion: { increment: 1 } }) },
  });
  await audit(admin, STATUS_ACTION[status], { targetType: "user", targetId: id, detail: { from: user.accountStatus, to: status, reason: reason ?? null, email: user.email } });
  return { ok: true, status };
}

export const adminInfoSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  institution: z.string().trim().max(120).nullable().optional(),
  field: z.string().trim().max(120).nullable().optional(),
  className: z.string().trim().max(60).nullable().optional(),
  level: z.enum(["BTS1", "BTS2", "L1", "L2", "L3", "M1", "M2", "AUTRE"]).nullable().optional(),
  category: z.enum(["ESATIC", "OTHER_SCHOOL", "TESTER"]).optional(),
});

/** Corrige des renseignements administratifs (jamais l'e-mail, le mot de passe ni les contenus de l'étudiant). */
export async function updateAdminInfo(admin: AdminUser, id: string, raw: unknown) {
  const input = adminInfoSchema.parse(raw);
  const user = await targetUser(admin, id);
  const { name, ...profile } = input;
  const data = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined));
  if (name === undefined && !Object.keys(data).length) throw new ApiHttpError("Aucune modification fournie.", 422);
  await db.$transaction(async (tx) => {
    if (name !== undefined) await tx.user.update({ where: { id }, data: { name } });
    if (Object.keys(data).length) await tx.studentProfile.upsert({ where: { userId: id }, create: { userId: id, ...data }, update: data });
  });
  forgetCategory(id);
  await audit(admin, "user.update", { targetType: "user", targetId: id, detail: { fields: [...(name !== undefined ? ["name"] : []), ...Object.keys(data)], email: user.email } });
  return { ok: true };
}

export const deleteSchema = z.object({ confirmEmail: z.string().trim().max(320) });

/** Suppression définitive : l'administrateur doit saisir l'adresse du compte. Les statistiques agrégées sont conservées (pseudonymisées). */
export async function deleteUserAccount(admin: AdminUser, id: string, raw: unknown) {
  const { confirmEmail } = deleteSchema.parse(raw);
  const user = await targetUser(admin, id);
  if (confirmEmail.toLowerCase() !== user.email.toLowerCase()) throw new ApiHttpError("L'adresse saisie ne correspond pas à celle du compte.", 422);
  await purgeAccount(id);
  await audit(admin, "user.delete", { targetType: "user", targetId: id, detail: { email: user.email, category: user.profile?.category ?? null } });
  return { ok: true };
}

