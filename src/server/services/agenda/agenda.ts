import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { softDelete } from "@/lib/soft-delete";
import { addDays, breakOverlap, type BreakRecord, daysBetween, expandEvents, findConflicts, formatMinutes, isDate, occurrenceDates, validateTimes, type Occurrence, type Recurrence, type ScheduleEventRecord, type ScheduleOverrideRecord, type WeekPattern } from "@/server/domain/schedule";

// ─────────────────────────────────────────────────────────────────────────────
// Agenda : source unique des cours, utilisée par le calendrier, le mini-emploi du temps et les suggestions.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RANGE_DAYS = 62;
/** Horizon de contrôle des chevauchements pour une série : deux semaines A/B × 8. */
const SERIES_HORIZON_DAYS = 16 * 7;

const dateField = z.string().refine(isDate, "Date invalide.");
const minutes = z.number().int().min(0).max(1440);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => v || null);
const pattern = z.enum(["ALL", "A", "B"]);
const kind = z.enum(["COURSE", "REVISION", "EVENT", "EXAM", "SPECIAL", "HOLIDAY"]);

export const createEventSchema = z.object({
  title: z.string().trim().max(160).optional(),
  subjectId: z.string().min(1).nullable().optional(),
  kind: kind.default("COURSE"),
  date: dateField,
  startMinutes: minutes,
  endMinutes: minutes,
  recurrence: z.enum(["NONE", "WEEKLY"]).default("NONE"),
  until: dateField.nullable().optional(),
  weekPattern: pattern.default("ALL"),
  sessionType: optionalText(20),
  code: optionalText(40),
  room: optionalText(120),
  teacher: optionalText(120),
  groupName: optionalText(120),
  description: optionalText(2000),
  /** Emploi du temps qui reçoit le cours (créé à la main ou importé). */
  scheduleId: z.string().min(1).max(40).nullable().optional(),
  force: z.boolean().optional(),
});

export const patchEventSchema = z.object({
  scope: z.enum(["all", "occurrence"]),
  occurrenceDate: dateField,
  title: z.string().trim().max(160).optional(),
  subjectId: z.string().min(1).nullable().optional(),
  date: dateField.optional(),
  startMinutes: minutes.optional(),
  endMinutes: minutes.optional(),
  recurrence: z.enum(["NONE", "WEEKLY", "DATES"]).optional(),
  until: dateField.nullable().optional(),
  weekPattern: pattern.optional(),
  sessionType: z.string().trim().max(20).nullable().optional(),
  room: z.string().trim().max(120).nullable().optional(),
  teacher: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  force: z.boolean().optional(),
});

type EventRow = Awaited<ReturnType<typeof loadEvents>>[number];

/**
 * Emploi du temps suivi par l'étudiant parmi ceux qu'il a importés. null : tous sont affichés (comportement d'origine).
 * Un emploi du temps supprimé entre-temps revient à « tous ».
 */
export async function activeScheduleOf(userId: string): Promise<string | null> {
  const s = await db.userSettings.findUnique({ where: { userId }, select: { activeScheduleId: true } });
  if (!s?.activeScheduleId) return null;
  const exists = await db.scheduleImport.count({ where: { id: s.activeScheduleId, userId, status: "CONFIRMED" } });
  return exists ? s.activeScheduleId : null;
}

/** Cours et pauses visibles : ceux saisis à la main et ceux de l'emploi du temps suivi. */
export const scheduleFilter = (active: string | null) => (active ? { OR: [{ importId: null }, { importId: active }] } : {});

/**
 * Périmètre lu : un emploi du temps précis (`scheduleId`, vérifié comme appartenant à l'étudiant), ou à défaut
 * l'emploi du temps suivi (null = tous).
 */
async function scopeWhere(userId: string, scheduleId?: string | null) {
  if (scheduleId) {
    await ownedSchedule(userId, scheduleId);
    return { importId: scheduleId };
  }
  return scheduleFilter(await activeScheduleOf(userId));
}

export async function ownedSchedule(userId: string, id: string) {
  const row = await db.scheduleImport.findFirst({ where: { id, userId, status: "CONFIRMED" }, select: { id: true } });
  if (!row) throw new ApiHttpError("Emploi du temps introuvable.", 404);
  return row;
}

const loadEvents = async (userId: string, scheduleId?: string | null) => db.scheduleEvent.findMany({ where: { userId, ...(await scopeWhere(userId, scheduleId)) }, include: { overrides: true } });
const toRecord = (e: EventRow): ScheduleEventRecord => ({ ...e, recurrence: e.recurrence as Recurrence, weekPattern: e.weekPattern as WeekPattern, dates: e.dates as string[] | null });
export const loadBreaks = async (userId: string, scheduleId?: string | null): Promise<(BreakRecord & { id: string; importId: string | null })[]> => db.scheduleBreak.findMany({ where: { userId, ...(await scopeWhere(userId, scheduleId)) } });

export async function weekSwapOf(userId: string): Promise<boolean> {
  const s = await db.userSettings.findUnique({ where: { userId }, select: { scheduleWeekSwap: true } });
  return s?.scheduleWeekSwap ?? false;
}

function expand(rows: EventRow[], from: string, to: string, swap: boolean): Occurrence[] {
  return expandEvents(rows.map(toRecord), rows.flatMap((e): ScheduleOverrideRecord[] => e.overrides), from, to, swap);
}

/** Séances d'une période avec leur matière. */
export async function occurrencesBetween(userId: string, from: string, to: string, scheduleId?: string | null) {
  const [rows, swap, subjects, breaks] = await Promise.all([loadEvents(userId, scheduleId), weekSwapOf(userId), db.subject.findMany({ where: { userId }, select: { id: true, name: true, color: true, icon: true }, orderBy: { name: "asc" } }), loadBreaks(userId, scheduleId)]);
  const byId = new Map(subjects.map((s) => [s.id, s]));
  const occurrences = expand(rows, from, to, swap).map((o) => ({ ...o, subject: o.subjectId ? (byId.get(o.subjectId) ?? null) : null }));
  return { occurrences, subjects, weekSwap: swap, breaks };
}

export async function listRange(userId: string, from: string, to: string, scheduleId?: string | null) {
  if (!isDate(from) || !isDate(to) || to < from) throw new ApiHttpError("Période invalide.", 422);
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new ApiHttpError("Période trop longue.", 422);
  return occurrencesBetween(userId, from, to, scheduleId);
}

async function requireOwnedSubject(userId: string, subjectId: string) {
  const s = await db.subject.findFirst({ where: { id: subjectId, userId }, select: { id: true, name: true } });
  if (!s) throw new ApiHttpError("Matière introuvable.", 404);
  return s;
}

interface Slot {
  date: string;
  startMinutes: number;
  endMinutes: number;
}

const describe = (o: Pick<Occurrence, "title" | "startMinutes" | "endMinutes" | "date">) => `« ${o.title} » (${o.date}, ${formatMinutes(o.startMinutes)}–${formatMinutes(o.endMinutes)})`;

/** Refuse un créneau sur une pause ou sur un autre cours, sauf confirmation explicite de l'étudiant (`force`). */
function assertFree(slots: Slot[], rows: EventRow[], breaks: BreakRecord[], swap: boolean, ignore: (o: Occurrence) => boolean, force: boolean | undefined) {
  if (force || !slots.length) return;
  const problems: string[] = [];
  const pause = slots.map((s) => breakOverlap(s.startMinutes, s.endMinutes, breaks, s.date)).find(Boolean);
  if (pause) problems.push(`Ce créneau empiète sur la période « ${pause.label} » (${formatMinutes(pause.startMinutes)}–${formatMinutes(pause.endMinutes)}).`);
  const dates = slots.map((s) => s.date).sort();
  const others = expand(rows, dates[0], dates[dates.length - 1], swap).filter((o) => !o.allDay && !ignore(o));
  const conflict = slots.flatMap((s) => findConflicts(s, others))[0];
  if (conflict) problems.push(`Ce créneau chevauche ${describe(conflict)}.`);
  if (problems.length) throw new ApiHttpError(problems.join(" "), 409, { confirmable: true });
}

function seriesSlots(e: Pick<ScheduleEventRecord, "date" | "recurrence" | "until" | "weekPattern" | "startMinutes" | "endMinutes"> & { dates?: string[] | null }, swap: boolean): Slot[] {
  return occurrenceDates(e, e.date, e.dates?.length ? e.dates[e.dates.length - 1] : addDays(e.date, SERIES_HORIZON_DAYS), swap).map((date) => ({ date, startMinutes: e.startMinutes, endMinutes: e.endMinutes }));
}

function assertTimes(start: number, end: number) {
  const problem = validateTimes(start, end);
  if (problem) throw new ApiHttpError(problem, 422);
}

export async function createEvent(userId: string, input: z.infer<typeof createEventSchema>) {
  assertTimes(input.startMinutes, input.endMinutes);
  if (input.until && input.until < input.date) throw new ApiHttpError("La fin de la répétition précède le premier cours.", 422);
  const subject = input.subjectId ? await requireOwnedSubject(userId, input.subjectId) : null;
  const title = input.title?.trim() || subject?.name;
  if (!title) throw new ApiHttpError("Indiquez un titre ou choisissez une matière.", 422);
  const [rows, swap, breaks] = await Promise.all([loadEvents(userId, input.scheduleId), weekSwapOf(userId), loadBreaks(userId, input.scheduleId)]);
  const { force, scheduleId, ...data } = input;
  const recurrence = data.recurrence;
  assertFree(seriesSlots({ ...data, recurrence, until: data.until ?? null }, swap), rows, breaks, swap, () => false, force);
  return db.scheduleEvent.create({ data: { ...data, title, userId, importId: scheduleId ?? null, subjectId: subject?.id ?? null, until: recurrence === "WEEKLY" ? (data.until ?? null) : null, weekPattern: recurrence === "WEEKLY" ? data.weekPattern : "ALL" } });
}

async function ownedEvent(userId: string, id: string) {
  const event = await db.scheduleEvent.findFirst({ where: { id, userId }, include: { overrides: true } });
  if (!event) throw new ApiHttpError("Cours introuvable.", 404);
  return event;
}

export async function updateEvent(userId: string, id: string, patch: z.infer<typeof patchEventSchema>) {
  const event = await ownedEvent(userId, id);
  if (patch.subjectId) await requireOwnedSubject(userId, patch.subjectId);
  // Les chevauchements se vérifient dans l'emploi du temps du cours modifié.
  const [rows, swap, breaks] = await Promise.all([loadEvents(userId, event.importId), weekSwapOf(userId), loadBreaks(userId, event.importId)]);
  const override = event.overrides.find((o) => o.date === patch.occurrenceDate);
  const current = {
    date: override?.newDate ?? patch.occurrenceDate,
    startMinutes: override?.startMinutes ?? event.startMinutes,
    endMinutes: override?.endMinutes ?? event.endMinutes,
  };
  const startMinutes = patch.startMinutes ?? current.startMinutes;
  const endMinutes = patch.endMinutes ?? current.endMinutes;
  const date = patch.date ?? current.date;
  assertTimes(startMinutes, endMinutes);

  const editOne = patch.scope === "occurrence" && event.recurrence !== "NONE";
  if (editOne) {
    assertFree([{ date, startMinutes, endMinutes }], rows, breaks, swap, (o) => o.key === `${event.id}:${patch.occurrenceDate}`, patch.force);
    const data = {
      cancelled: false,
      newDate: date === patch.occurrenceDate ? null : date,
      startMinutes,
      endMinutes,
      subjectId: patch.subjectId === undefined ? (override?.subjectId ?? null) : patch.subjectId,
      title: patch.title || override?.title || null,
      room: patch.room === undefined ? (override?.room ?? null) : patch.room || null,
      teacher: patch.teacher === undefined ? (override?.teacher ?? null) : patch.teacher || null,
      description: patch.description === undefined ? (override?.description ?? null) : patch.description || null,
    };
    await db.scheduleOverride.upsert({ where: { eventId_date: { eventId: event.id, date: patch.occurrenceDate } }, create: { eventId: event.id, date: patch.occurrenceDate, ...data }, update: data });
    return { ok: true };
  }

  // Toute la série : un déplacement de jour décale aussi ses séances modifiées, qui restent rattachées à leur semaine.
  const shift = daysBetween(current.date, date);
  const recurrence = (patch.recurrence ?? event.recurrence) as Recurrence;
  const updated = {
    date: addDays(event.date, shift),
    startMinutes,
    endMinutes,
    recurrence,
    until: patch.until === undefined ? event.until : patch.until,
    weekPattern: (patch.weekPattern ?? event.weekPattern) as WeekPattern,
    dates: ((event.dates as string[] | null) ?? null)?.map((d) => addDays(d, shift)) ?? null,
  };
  assertFree(seriesSlots(updated, swap), rows, breaks, swap, (o) => o.eventId === event.id, patch.force || event.allDay);
  const fields = {
    ...updated,
    dates: updated.dates ?? Prisma.DbNull,
    ...(patch.sessionType !== undefined ? { sessionType: patch.sessionType || null } : {}),
    ...(patch.title ? { title: patch.title } : {}),
    ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
    ...(patch.room !== undefined ? { room: patch.room || null } : {}),
    ...(patch.teacher !== undefined ? { teacher: patch.teacher || null } : {}),
    ...(patch.description !== undefined ? { description: patch.description || null } : {}),
  };
  await db.$transaction([
    db.scheduleEvent.update({ where: { id: event.id }, data: fields }),
    ...(shift !== 0 && event.overrides.length
      ? [
          db.scheduleOverride.deleteMany({ where: { eventId: event.id } }),
          db.scheduleOverride.createMany({ data: event.overrides.map(({ id: _id, ...o }) => ({ ...o, date: addDays(o.date, shift), newDate: o.newDate ? addDays(o.newDate, shift) : null })) }),
        ]
      : []),
  ]);
  return { ok: true };
}

export async function deleteEvent(userId: string, id: string, scope: "all" | "occurrence", occurrenceDate: string | null) {
  const event = await ownedEvent(userId, id);
  if (scope === "occurrence" && event.recurrence !== "NONE") {
    if (!occurrenceDate || !isDate(occurrenceDate)) throw new ApiHttpError("Date de la séance manquante.", 422);
    await db.scheduleOverride.upsert({ where: { eventId_date: { eventId: event.id, date: occurrenceDate } }, create: { eventId: event.id, date: occurrenceDate, cancelled: true }, update: { cancelled: true } });
    return { ok: true };
  }
  await softDelete(db, "ScheduleEvent", { id: event.id });
  return { ok: true };
}

export async function setWeekSwap(userId: string, weekSwap: boolean) {
  await db.userSettings.upsert({ where: { userId }, create: { userId, scheduleWeekSwap: weekSwap }, update: { scheduleWeekSwap: weekSwap } });
  return { weekSwap };
}
