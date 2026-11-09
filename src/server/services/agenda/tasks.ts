import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { DEFAULT_PREFS, PRIORITIES, TASK_STATUSES, TASK_TYPES, effectiveStatus, isOpen, planStudySessions, type BusySlot, type PlannerPrefs, type StoredStatus } from "@/server/domain/academic";
import { addDays, breakOverlap, findConflicts, isDate, overlaps, validateTimes, weekday } from "@/server/domain/schedule";
import { occurrencesBetween } from "./agenda";

// Tâches, séances de travail et préférences de l'agenda académique. Tout est filtré par propriétaire.

const dateField = z.string().refine(isDate, "Date invalide.");
const minutes = z.number().int().min(0).max(1440);
const text = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);

const taskFields = {
  title: z.string().trim().min(1, "Indiquez un titre.").max(200),
  description: text(4000),
  subjectId: z.string().min(1).nullable().optional(),
  documentId: z.string().min(1).nullable().optional(),
  exerciseId: z.string().min(1).nullable().optional(),
  parentId: z.string().min(1).nullable().optional(),
  type: z.enum(TASK_TYPES).default("DEVOIR"),
  priority: z.enum(PRIORITIES).default("NORMALE"),
  status: z.enum(TASK_STATUSES).default("A_COMMENCER"),
  dueDate: dateField,
  dueMinutes: minutes.nullable().optional(),
  estimatedMinutes: z.number().int().min(15).max(10_000).nullable().optional(),
  requiresSubmission: z.boolean().default(false),
  reminderMinutes: z.array(z.number().int().min(0).max(43_200)).max(5).optional(),
  recurrence: z.enum(["NONE", "WEEKLY"]).default("NONE"),
};

export const createTaskSchema = z.object(taskFields);
export const patchTaskSchema = z.object(taskFields).partial();

const taskInclude = { subject: { select: { id: true, name: true, color: true, icon: true } }, sessions: { orderBy: [{ date: "asc" as const }, { startMinutes: "asc" as const }] } };

async function assertRelations(userId: string, input: { subjectId?: string | null; documentId?: string | null; exerciseId?: string | null; parentId?: string | null }) {
  const [subject, document, exercise, parent] = await Promise.all([
    input.subjectId ? db.subject.findFirst({ where: { id: input.subjectId, userId }, select: { id: true } }) : true,
    input.documentId ? db.document.findFirst({ where: { id: input.documentId, userId }, select: { id: true } }) : true,
    input.exerciseId ? db.exercise.findFirst({ where: { id: input.exerciseId, userId }, select: { id: true } }) : true,
    input.parentId ? db.academicTask.findFirst({ where: { id: input.parentId, userId }, select: { id: true } }) : true,
  ]);
  if (!subject || !document || !exercise || !parent) throw new ApiHttpError("Élément associé introuvable.", 404);
}

export const clockSchema = z.object({ date: dateField, minutes: z.coerce.number().int().min(0).max(1439) });
export type Clock = z.infer<typeof clockSchema>;

export async function listTasks(userId: string, clock: Clock) {
  const rows = await db.academicTask.findMany({ where: { userId }, include: taskInclude, orderBy: [{ dueDate: "asc" }, { dueMinutes: "asc" }], take: 500 });
  return rows.map((t) => ({ ...t, status: effectiveStatus({ ...t, status: t.status as StoredStatus }, clock.date, clock.minutes), storedStatus: t.status }));
}

export type TaskDto = Awaited<ReturnType<typeof listTasks>>[number];

/** Tâches prioritaires pour le tableau de bord. */
export function taskOverview(tasks: TaskDto[], today: string) {
  const open = tasks.filter((t) => isOpen(t.status));
  const late = open.filter((t) => t.status === "EN_RETARD");
  const week = addDays(today, 7);
  return { late, upcoming: open.filter((t) => t.status !== "EN_RETARD" && t.dueDate <= week).slice(0, 5), thisWeek: open.filter((t) => t.status !== "EN_RETARD" && t.dueDate <= week).length };
}

export async function createTask(userId: string, input: z.infer<typeof createTaskSchema>) {
  await assertRelations(userId, input);
  return db.academicTask.create({ data: { ...input, userId, dueMinutes: input.dueMinutes ?? null, estimatedMinutes: input.estimatedMinutes ?? null, reminderMinutes: input.reminderMinutes ?? [1440] } });
}

async function ownedTask(userId: string, id: string) {
  const task = await db.academicTask.findFirst({ where: { id, userId } });
  if (!task) throw new ApiHttpError("Tâche introuvable.", 404);
  return task;
}

export async function updateTask(userId: string, id: string, patch: z.infer<typeof patchTaskSchema>) {
  const task = await ownedTask(userId, id);
  await assertRelations(userId, patch);
  const now = new Date();
  const completing = patch.status && patch.status !== task.status && (patch.status === "TERMINE" || patch.status === "SOUMIS");
  const updated = await db.academicTask.update({
    where: { id },
    data: { ...patch, ...(patch.status === "TERMINE" && !task.completedAt ? { completedAt: now } : {}), ...(patch.status === "SOUMIS" ? { submittedAt: now, completedAt: task.completedAt ?? now } : {}) },
  });
  // Tâche hebdomadaire : la suivante est créée quand celle-ci est terminée pour de bon.
  const finished = completing && (patch.status === "SOUMIS" || !updated.requiresSubmission);
  if (finished && updated.recurrence === "WEEKLY") {
    await db.academicTask.create({ data: { userId, title: updated.title, description: updated.description, subjectId: updated.subjectId, documentId: updated.documentId, type: updated.type, priority: updated.priority, dueDate: addDays(updated.dueDate, 7), dueMinutes: updated.dueMinutes, estimatedMinutes: updated.estimatedMinutes, requiresSubmission: updated.requiresSubmission, reminderMinutes: updated.reminderMinutes ?? [1440], recurrence: "WEEKLY" } });
    await db.academicTask.update({ where: { id }, data: { recurrence: "NONE" } });
  }
  return updated;
}

export async function deleteTask(userId: string, id: string) {
  await ownedTask(userId, id);
  await db.academicTask.delete({ where: { id } });
  return { ok: true };
}

// ── Préférences ──────────────────────────────────────────────────────────────

export const prefsSchema = z.object({
  workStart: minutes,
  workEnd: minutes,
  maxDailyMinutes: z.number().int().min(30).max(720),
  restMinutes: z.number().int().min(0).max(120),
  weekends: z.boolean(),
  quietStart: minutes,
  quietEnd: minutes,
  courseReminderMinutes: z.number().int().min(0).max(240).default(DEFAULT_PREFS.courseReminderMinutes),
  taskReminders: z.boolean().default(true),
  sessionReminders: z.boolean().default(true),
  lateReminders: z.boolean().default(true),
});

export async function getPrefs(userId: string): Promise<PlannerPrefs> {
  const s = await db.userSettings.findUnique({ where: { userId }, select: { agendaPrefs: true } });
  return { ...DEFAULT_PREFS, ...((s?.agendaPrefs as Partial<PlannerPrefs> | null) ?? {}) };
}

export async function savePrefs(userId: string, prefs: PlannerPrefs) {
  if (prefs.workEnd <= prefs.workStart) throw new ApiHttpError("La fin de la période de travail doit suivre son début.", 422);
  const agendaPrefs = prefs as unknown as Prisma.InputJsonValue;
  await db.userSettings.upsert({ where: { userId }, create: { userId, agendaPrefs }, update: { agendaPrefs } });
  return prefs;
}

// ── Planification ────────────────────────────────────────────────────────────

/** Tout ce qui occupe l'étudiant : cours, pauses et séances déjà acceptées. */
async function busySlots(userId: string, from: string, to: string, exceptTaskId?: string): Promise<BusySlot[]> {
  const [{ occurrences }, sessions, breaks] = await Promise.all([occurrencesBetween(userId, from, to), db.studySession.findMany({ where: { userId, date: { gte: from, lte: to }, ...(exceptTaskId ? { taskId: { not: exceptTaskId } } : {}) } }), db.scheduleBreak.findMany({ where: { userId } })]);
  const out: BusySlot[] = [...occurrences.filter((o) => !o.allDay), ...sessions].map((s) => ({ date: s.date, startMinutes: s.startMinutes, endMinutes: s.endMinutes }));
  // Une journée couverte par un congé ou des examens n'est pas proposée comme disponible par défaut.
  for (const o of occurrences.filter((x) => x.allDay && x.kind !== "HOLIDAY")) out.push({ date: o.date, startMinutes: 0, endMinutes: 1440 });
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const b of breaks) if (b.weekday === null || b.weekday === weekday(d)) out.push({ date: d, startMinutes: b.startMinutes, endMinutes: b.endMinutes });
  }
  return out;
}

export async function proposePlan(userId: string, id: string, clock: Clock) {
  const task = await ownedTask(userId, id);
  if (!task.estimatedMinutes) throw new ApiHttpError("Indiquez d'abord le temps de travail estimé.", 422);
  const [busy, prefs, done] = await Promise.all([busySlots(userId, clock.date, task.dueDate, id), getPrefs(userId), db.studySession.findMany({ where: { taskId: id, userId, done: true } })]);
  const already = done.reduce((t, s) => t + s.endMinutes - s.startMinutes, 0);
  return planStudySessions({ today: clock.date, nowMinutes: clock.minutes, dueDate: task.dueDate, dueMinutes: task.dueMinutes, estimatedMinutes: Math.max(0, task.estimatedMinutes - already), busy, prefs });
}

export const acceptPlanSchema = z.object({ sessions: z.array(z.object({ date: dateField, startMinutes: minutes, endMinutes: minutes })).max(60), force: z.boolean().optional() });

/** Enregistre les séances choisies par l'étudiant, à la place des séances non réalisées de cette tâche. */
export async function acceptPlan(userId: string, id: string, input: z.infer<typeof acceptPlanSchema>) {
  await ownedTask(userId, id);
  for (const s of input.sessions) {
    const problem = validateTimes(s.startMinutes, s.endMinutes);
    if (problem) throw new ApiHttpError(problem, 422);
  }
  const conflict = input.sessions.find((s, i) => input.sessions.some((o, j) => j !== i && o.date === s.date && overlaps(s, o)));
  if (conflict) throw new ApiHttpError("Deux séances se chevauchent.", 422);
  if (!input.force && input.sessions.length) {
    const dates = input.sessions.map((s) => s.date).sort();
    const [{ occurrences }, others, breaks] = await Promise.all([occurrencesBetween(userId, dates[0], dates[dates.length - 1]), db.studySession.findMany({ where: { userId, taskId: { not: id } } }), db.scheduleBreak.findMany({ where: { userId } })]);
    const busy = [...occurrences.filter((o) => !o.allDay).map((o) => ({ key: o.key, date: o.date, title: o.title, startMinutes: o.startMinutes, endMinutes: o.endMinutes })), ...others.map((o) => ({ key: o.id, date: o.date, title: "une autre séance", startMinutes: o.startMinutes, endMinutes: o.endMinutes }))];
    for (const s of input.sessions) {
      const clash = findConflicts(s, busy)[0];
      if (clash) throw new ApiHttpError(`Une séance du ${s.date} chevauche « ${clash.title} ».`, 409, { confirmable: true });
      const pause = breakOverlap(s.startMinutes, s.endMinutes, breaks, s.date);
      if (pause) throw new ApiHttpError(`Une séance du ${s.date} empiète sur « ${pause.label} ».`, 409, { confirmable: true });
    }
  }
  await db.$transaction([db.studySession.deleteMany({ where: { taskId: id, userId, done: false } }), db.studySession.createMany({ data: input.sessions.map((s) => ({ ...s, userId, taskId: id })) })]);
  return { ok: true, count: input.sessions.length };
}

export async function deleteSession(userId: string, id: string) {
  const { count } = await db.studySession.deleteMany({ where: { id, userId } });
  if (!count) throw new ApiHttpError("Séance introuvable.", 404);
  return { ok: true };
}

export async function setSessionDone(userId: string, id: string, done: boolean) {
  const { count } = await db.studySession.updateMany({ where: { id, userId }, data: { done } });
  if (!count) throw new ApiHttpError("Séance introuvable.", 404);
  return { ok: true };
}

export async function listBreaks(userId: string) {
  return db.scheduleBreak.findMany({ where: { userId }, orderBy: { startMinutes: "asc" } });
}

export const breakSchema = z.object({ label: z.string().trim().min(1).max(60), startMinutes: minutes, endMinutes: minutes, weekday: z.number().int().min(1).max(7).nullable().default(null) });

export async function createBreak(userId: string, input: z.infer<typeof breakSchema>) {
  const problem = validateTimes(input.startMinutes, input.endMinutes);
  if (problem) throw new ApiHttpError(problem, 422);
  return db.scheduleBreak.create({ data: { ...input, userId } });
}

export async function deleteBreak(userId: string, id: string) {
  const { count } = await db.scheduleBreak.deleteMany({ where: { id, userId } });
  if (!count) throw new ApiHttpError("Pause introuvable.", 404);
  return { ok: true };
}
