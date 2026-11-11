import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { softDelete } from "@/lib/soft-delete";
import { normalizeSubjectName } from "@/lib/subjects";
import { AiCallError, AiQuotaError, AiUnavailableError } from "@/server/ai/provider";
import { addDays, breakOverlap, diffImport, sameSubjectName, expandEvents, findConflicts, formatMinutes, isDate, occurrenceDates, validateTimes, weekday, type ExistingCourse, type Recurrence, type ScheduleEventRecord, type ScheduleOverrideRecord, type WeekPattern } from "@/server/domain/schedule";
import { getStorage, newStorageKey } from "@/server/storage";
import { suggestSubjectIcon } from "@/server/domain/subject-icon";
import { activeScheduleOf, ownedSchedule, scheduleFilter, weekSwapOf } from "./agenda";
import { extractContent, identifyFile } from "./extract";
import { interpretSchedule, normalizeImport, type DraftEvent, type DraftSchedule } from "./interpret";

// ─────────────────────────────────────────────────────────────────────────────
// Import d'un emploi du temps, de bout en bout : fichier conservé → contenu extrait → interprétation par l'IA →
// brouillon soumis à l'étudiant → enregistrement après sa validation uniquement.
// ─────────────────────────────────────────────────────────────────────────────

const HORIZON_DAYS = 16 * 7;
const SUBJECT_COLORS = ["#8b5cf6", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#6366f1", "#14b8a6", "#ef4444"];

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

/** Cours déjà enregistrés auxquels un import est comparé : ceux de l'emploi du temps suivi (ou tous si aucun n'est choisi). */
async function existingCourses(userId: string, active: string | null = null): Promise<ExistingCourse[]> {
  const rows = await db.scheduleEvent.findMany({ where: { userId, recurrence: { in: ["WEEKLY", "DATES"] }, allDay: false, ...scheduleFilter(active) }, select: { id: true, title: true, date: true, startMinutes: true, endMinutes: true, room: true, teacher: true, weekPattern: true, importId: true, code: true, dates: true } });
  return rows.map((r) => ({ ...r, weekPattern: r.weekPattern as WeekPattern, dates: r.dates as string[] | null }));
}

function withDiff({ events: drafts, breaks, specials }: DraftSchedule, existing: ExistingCourse[]) {
  const { items, removed } = diffImport(drafts.filter((d: DraftEvent) => d.recurring), existing);
  const status = new Map(items.map((i) => [i.draft.id, i]));
  return {
    events: drafts.map((d) => ({ ...d, status: status.get(d.id)?.status ?? "nouveau", changes: status.get(d.id)?.changes ?? [] })),
    breaks,
    specials,
    removed: removed.map((r) => ({ id: r.id, title: r.title, day: weekday(r.date), startMinutes: r.startMinutes, endMinutes: r.endMinutes })),
  };
}

/** `targetId` : emploi du temps auquel le document sera comparé (celui affiché), sinon l'emploi du temps suivi. */
export async function startImport(userId: string, file: File, targetId?: string | null) {
  if (targetId) await ownedSchedule(userId, targetId);
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.replace(/[\\/\0]/g, "_").slice(0, 200);
  const { extension, mime } = identifyFile(name, bytes);
  const content = await extractContent(extension, bytes);
  const subjects = await db.subject.findMany({ where: { userId }, select: { id: true, name: true, color: true, icon: true }, orderBy: { name: "asc" } });

  let raw;
  try {
    raw = await interpretSchedule(userId, content);
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    if (e instanceof AiUnavailableError) throw new ApiHttpError("Le service d'IA n'est pas configuré : l'analyse automatique est indisponible.", 503);
    if (e instanceof AiCallError) throw new ApiHttpError("L'analyse du document n'a pas abouti. Réessayez dans un instant.", 502);
    throw e;
  }
  const drafts = normalizeImport(raw, subjects, content.kind === "text" ? content.text : null);
  const warnings = [...content.warnings, ...(raw.avertissements ?? [])];
  if (!drafts.events.length) warnings.push("Aucun cours n'a été identifié dans ce document.");

  const id = randomUUID().replace(/-/g, "");
  const storageKey = newStorageKey(userId, id, 1, randomBytes(8).toString("hex"));
  await getStorage().put(storageKey, bytes, mime);
  await db.scheduleImport.create({ data: { id, userId, fileName: name, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storageKey, draft: asJson(drafts), warnings: asJson(warnings) } });
  return { id, fileName: name, warnings, subjects, ...withDiff(drafts, await existingCourses(userId, targetId ?? (await activeScheduleOf(userId)))) };
}

async function ownedImport(userId: string, id: string) {
  const row = await db.scheduleImport.findFirst({ where: { id, userId } });
  if (!row) throw new ApiHttpError("Import introuvable.", 404);
  return row;
}

const MANUAL_MIME = "application/x-niala-manual";

/** Emploi du temps vide, créé à la main : ses cours, pauses et plages s'ajoutent ensuite dans l'éditeur. */
export async function createSchedule(userId: string, input: { label: string; activate?: boolean }) {
  const label = input.label.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!label) throw new ApiHttpError("Donnez un nom à l'emploi du temps.", 422);
  const row = await db.scheduleImport.create({
    data: { userId, source: "MANUAL", label, fileName: label, mime: MANUAL_MIME, size: 0, sha256: "", storageKey: "", status: "CONFIRMED", confirmedAt: new Date(), draft: {}, warnings: [] },
    select: { id: true, label: true },
  });
  if (input.activate !== false) await setActiveSchedule(userId, row.id);
  return row;
}

/**
 * Cours et pauses saisis autrefois sans emploi du temps : ils rejoignent une fois pour toutes l'emploi du temps suivi
 * (ou « Mes cours » s'il n'y en a pas), pour que chaque cours appartienne à un emploi du temps modifiable. Rien n'est supprimé.
 */
async function adoptLooseEntries(userId: string) {
  const [events, breaks] = await Promise.all([db.scheduleEvent.count({ where: { userId, importId: null } }), db.scheduleBreak.count({ where: { userId, importId: null } })]);
  if (!events && !breaks) return;
  // Ils restaient visibles avec l'emploi du temps suivi : ils le rejoignent. Sans emploi du temps suivi, « Mes cours » est créé.
  const active = await activeScheduleOf(userId);
  const row = active ? { id: active } : await db.scheduleImport.create({ data: { userId, source: "MANUAL", label: "Mes cours", fileName: "Mes cours", mime: MANUAL_MIME, size: 0, sha256: "", storageKey: "", status: "CONFIRMED", confirmedAt: new Date(), draft: {}, warnings: [] }, select: { id: true } });
  await db.$transaction([
    db.scheduleEvent.updateMany({ where: { userId, importId: null }, data: { importId: row.id } }),
    db.scheduleBreak.updateMany({ where: { userId, importId: null }, data: { importId: row.id } }),
  ]);
}

/** Emplois du temps de l'étudiant (importés ou créés à la main) et celui qu'il suit. */
export async function listImports(userId: string) {
  await adoptLooseEntries(userId);
  const [rows, activeId] = await Promise.all([
    db.scheduleImport.findMany({ where: { userId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, label: true, fileName: true, source: true, createdAt: true, confirmedAt: true, _count: { select: { events: { where: { deletedAt: null } }, breaks: { where: { deletedAt: null } } } } } }),
    activeScheduleOf(userId),
  ]);
  // Un ancien import dont tous les cours ont été fusionnés ailleurs n'est plus proposé ; un emploi du temps créé à la main reste, même vide.
  const imports = rows.filter((r) => r.source === "MANUAL" || r._count.events > 0 || r.id === activeId).map((r) => ({ ...r, label: r.label?.trim() || r.fileName }));
  return { imports, activeId };
}

/** Choix de l'emploi du temps à suivre ; null affiche tous les emplois du temps. */
export async function setActiveSchedule(userId: string, id: string | null) {
  if (id) await ownedImport(userId, id).then((row) => {
    if (row.status !== "CONFIRMED") throw new ApiHttpError("Cet emploi du temps n'est pas encore validé.", 409);
  });
  await db.userSettings.upsert({ where: { userId }, create: { userId, activeScheduleId: id }, update: { activeScheduleId: id } });
  return { activeId: id };
}

export async function renameSchedule(userId: string, id: string, label: string) {
  await ownedImport(userId, id);
  const clean = label.trim().replace(/\s+/g, " ").slice(0, 80);
  if (!clean) throw new ApiHttpError("Indiquez un nom.", 422);
  await db.scheduleImport.update({ where: { id }, data: { label: clean } });
  return { id, label: clean };
}

/** Suppression d'un emploi du temps importé : ses cours, pauses et périodes particulières disparaissent ; les cours saisis à la main restent. */
export async function deleteSchedule(userId: string, id: string) {
  const row = await ownedImport(userId, id);
  if (row.status !== "CONFIRMED") return cancelImport(userId, id);
  const settings = await db.userSettings.findUnique({ where: { userId }, select: { activeScheduleId: true } });
  const events = await db.$transaction(async (tx) => {
    const removed = await softDelete(tx, "ScheduleEvent", { userId, importId: id });
    await softDelete(tx, "ScheduleBreak", { userId, importId: id });
    if (settings?.activeScheduleId === id) await tx.userSettings.update({ where: { userId }, data: { activeScheduleId: null } });
    await softDelete(tx, "ScheduleImport", { id });
    return removed;
  });
  if (row.storageKey) await getStorage().remove([row.storageKey]).catch(() => undefined);
  return { ok: true, removedEvents: events.length };
}

/** Abandon d'un import non validé : le fichier et le brouillon sont supprimés. */
export async function cancelImport(userId: string, id: string) {
  const row = await ownedImport(userId, id);
  if (row.status === "CONFIRMED") throw new ApiHttpError("Cet import a déjà été validé.", 409);
  await softDelete(db, "ScheduleImport", { id: row.id });
  await getStorage().remove([row.storageKey]).catch(() => undefined);
  return { ok: true };
}

export async function importFile(userId: string, id: string) {
  const row = await ownedImport(userId, id);
  if (!row.storageKey) throw new ApiHttpError("Cet emploi du temps a été créé à la main : il n'a pas de fichier d'origine.", 404);
  return { data: await getStorage().read(row.storageKey), mime: row.mime, fileName: row.fileName };
}

const confirmedEvent = z.object({
  id: z.string().max(40),
  title: z.string().trim().min(1, "Une matière est requise.").max(160),
  day: z.number().int().min(1).max(7),
  date: z.string().refine(isDate).nullable().optional(),
  startMinutes: z.number().int(),
  endMinutes: z.number().int(),
  room: z.string().trim().max(120).nullable().default(null),
  teacher: z.string().trim().max(120).nullable().default(null),
  groupName: z.string().trim().max(120).nullable().optional(),
  code: z.string().trim().max(40).nullable().default(null),
  sessionType: z.string().trim().max(20).nullable().default(null),
  dates: z.array(z.string().refine(isDate)).max(120).nullable().default(null),
  weekPattern: z.enum(["ALL", "A", "B"]),
  recurring: z.boolean(),
  confidence: z.enum(["elevee", "moyenne", "faible"]).optional(),
  subjectId: z.string().min(1).nullable().optional(),
  createSubject: z.boolean().optional(),
});

export const confirmSchema = z.object({
  /** add / replace : fusion avec l'emploi du temps suivi ; new : emploi du temps distinct, que l'étudiant pourra choisir de suivre. */
  mode: z.enum(["add", "replace", "new"]),
  label: z.string().trim().max(80).optional(),
  /** Mode « new » : suivre directement ce nouvel emploi du temps (par défaut). */
  activate: z.boolean().optional(),
  /** Modes « add » / « replace » : emploi du temps à compléter ou mettre à jour (par défaut, celui qui est suivi). */
  scheduleId: z.string().min(1).max(40).optional(),
  startDate: z.string().refine(isDate, "Date de début invalide."),
  events: z.array(confirmedEvent).min(1, "Aucun cours à enregistrer.").max(200),
  breaks: z.array(z.object({ label: z.string().trim().min(1).max(60), startMinutes: z.number().int().min(0).max(1440), endMinutes: z.number().int().min(0).max(1440), weekday: z.number().int().min(1).max(7).nullable().default(null) })).max(20).default([]),
  specials: z.array(z.object({ label: z.string().trim().min(1).max(160), kind: z.enum(["HOLIDAY", "EXAM", "SPECIAL"]), startDate: z.string().refine(isDate), endDate: z.string().refine(isDate), startMinutes: z.number().int().min(0).max(1440).nullable().default(null), endMinutes: z.number().int().min(0).max(1440).nullable().default(null) })).max(40).default([]),
  force: z.boolean().optional(),
});

function firstDateOn(startDate: string, day: number): string {
  return addDays(startDate, (day - weekday(startDate) + 7) % 7);
}

export async function confirmImport(userId: string, id: string, input: z.infer<typeof confirmSchema>) {
  const row = await ownedImport(userId, id);
  if (row.status === "CONFIRMED") throw new ApiHttpError("Cet import a déjà été validé.", 409);

  for (const e of input.events) {
    const problem = validateTimes(e.startMinutes, e.endMinutes);
    if (problem) throw new ApiHttpError(`« ${e.title} » : ${problem}`, 422);
  }

  // Mode « new » : l'emploi du temps est indépendant, comparé seulement aux cours saisis à la main.
  // Modes « add » / « replace » : fusion avec l'emploi du temps suivi (ou avec tous les cours si aucun n'est choisi).
  const separate = input.mode === "new";
  if (input.scheduleId) await ownedSchedule(userId, input.scheduleId);
  const active = separate ? null : (input.scheduleId ?? (await activeScheduleOf(userId)));
  const visible = separate ? { importId: null } : scheduleFilter(active);
  /** Emploi du temps qui reçoit les cours : le nouveau, ou celui qui est suivi. */
  const target = separate ? row.id : (active ?? row.id);
  const [subjects, existing, allEvents, swap, existingBreaks] = await Promise.all([
    db.subject.findMany({ where: { userId }, select: { id: true, name: true } }),
    separate ? Promise.resolve([] as ExistingCourse[]) : existingCourses(userId, active),
    db.scheduleEvent.findMany({ where: { userId, ...visible }, include: { overrides: true } }),
    weekSwapOf(userId),
    db.scheduleBreak.findMany({ where: { userId, ...visible } }),
  ]);
  const owned = new Set(subjects.map((s) => s.id));
  if (input.events.some((e) => e.subjectId && !owned.has(e.subjectId))) throw new ApiHttpError("Matière introuvable.", 404);

  const recurring = input.events.filter((e) => e.recurring);
  const diff = diffImport(recurring, existing);
  const statusOf = new Map(diff.items.map((i) => [i.draft.id, i]));
  const replace = input.mode === "replace";

  // Identique : jamais recréé. Modifié : mis à jour en mode « remplacer », laissé tel quel en mode « compléter ».
  const toCreate = input.events.filter((e) => !statusOf.get(e.id) || statusOf.get(e.id)!.status === "nouveau");
  const toUpdate = replace ? diff.items.filter((i) => i.status === "modifie" && i.existingId) : [];
  const toRemove = replace ? diff.removed.map((r) => r.id) : [];
  const released = new Set([...toRemove, ...toUpdate.map((i) => i.existingId!)]);

  const slotsOf = (e: (typeof input.events)[number]) => {
    const date = e.dates?.[0] ?? e.date ?? firstDateOn(input.startDate, e.day);
    const horizon = e.dates?.length ? e.dates[e.dates.length - 1] : addDays(date, HORIZON_DAYS);
    return occurrenceDates({ date, recurrence: e.dates?.length ? "DATES" : e.recurring ? "WEEKLY" : "NONE", until: null, weekPattern: e.weekPattern, dates: e.dates }, date, horizon, swap).map((d) => ({ date: d, startMinutes: e.startMinutes, endMinutes: e.endMinutes, title: e.title, key: e.id }));
  };

  if (!input.force) {
    const planned = [...toCreate, ...toUpdate.map((i) => i.draft)];
    const known = [...input.breaks, ...existingBreaks];
    const pause = planned.find((e) => breakOverlap(e.startMinutes, e.endMinutes, known.filter((b) => b.weekday === null || b.weekday === e.day)));
    const records = allEvents.filter((e) => !released.has(e.id) && !e.allDay).map((e): ScheduleEventRecord => ({ ...e, recurrence: e.recurrence as Recurrence, weekPattern: e.weekPattern as WeekPattern, dates: e.dates as string[] | null }));
    const overrides = allEvents.flatMap((e): ScheduleOverrideRecord[] => e.overrides);
    const slots = planned.flatMap(slotsOf);
    const horizonEnd = addDays([input.startDate, ...slots.map((s) => s.date)].sort().at(-1)!, 14);
    const others = [...expandEvents(records, overrides, input.startDate, horizonEnd, swap), ...slots];
    const clash = slots.flatMap((s) => findConflicts(s, others.filter((o) => o.key !== s.key)).map((o) => ({ s, o })))[0];
    const problems = [
      pause ? `« ${pause.title} » empiète sur une pause (${formatMinutes(pause.startMinutes)}–${formatMinutes(pause.endMinutes)}).` : null,
      clash ? `« ${clash.s.title} » chevauche « ${clash.o.title} » le ${clash.s.date}.` : null,
    ].filter(Boolean);
    if (problems.length) throw new ApiHttpError(problems.join(" "), 409, { confirmable: true });
  }

  // Matières à créer : un même nom n'en crée qu'une, et une matière existante est réutilisée.
  const known = new Map(subjects.map((s) => [normalizeSubjectName(s.name), s.id]));
  const newSubjects: { id: string; userId: string; name: string; color: string; icon: string }[] = [];
  const subjectFor = (e: (typeof input.events)[number]): string | null => {
    if (e.subjectId) return e.subjectId;
    if (!e.createSubject) return null;
    const norm = normalizeSubjectName(e.title);
    let sid = known.get(norm);
    if (!sid) {
      sid = randomUUID().replace(/-/g, "");
      known.set(norm, sid);
      newSubjects.push({ id: sid, userId, name: e.title.trim().replace(/\s+/g, " "), color: SUBJECT_COLORS[newSubjects.length % SUBJECT_COLORS.length], icon: suggestSubjectIcon(e.title) });
    }
    return sid;
  };

  const creations = toCreate.map((e) => ({
    userId,
    importId: target,
    subjectId: subjectFor(e),
    title: e.title,
    date: e.dates?.[0] ?? e.date ?? firstDateOn(input.startDate, e.day),
    startMinutes: e.startMinutes,
    endMinutes: e.endMinutes,
    recurrence: e.dates?.length ? "DATES" : e.recurring ? "WEEKLY" : "NONE",
    dates: e.dates?.length ? e.dates : Prisma.DbNull,
    code: e.code,
    sessionType: e.sessionType,
    weekPattern: e.recurring ? e.weekPattern : "ALL",
    room: e.room || null,
    teacher: e.teacher || null,
    groupName: e.groupName || null,
    confidence: e.confidence ?? null,
    id: randomUUID().replace(/-/g, ""),
  }));
  const updates = toUpdate.map((i) => ({ id: i.existingId!, data: { startMinutes: i.draft.startMinutes, endMinutes: i.draft.endMinutes, ...(i.draft.room ? { room: i.draft.room } : {}), ...(i.draft.teacher ? { teacher: i.draft.teacher } : {}), ...(i.draft.dates?.length ? { dates: i.draft.dates, date: i.draft.dates[0] } : {}), importId: target, subjectId: subjectFor(i.draft) ?? undefined } }));

  const hasBreak = (b: (typeof input.breaks)[number]) => existingBreaks.some((x) => !(replace && x.importId) && x.startMinutes === b.startMinutes && x.endMinutes === b.endMinutes && x.weekday === b.weekday);
  const newBreaks = input.breaks.filter((b) => !hasBreak(b)).map((b) => ({ ...b, userId, importId: target }));
  const hasSpecial = (s: (typeof input.specials)[number]) => allEvents.some((e) => e.allDay && !(replace && e.importId) && e.date === s.startDate && sameSubjectName(e.title, s.label));
  const specials = input.specials.filter((s) => !hasSpecial(s)).map((s) => ({ id: randomUUID().replace(/-/g, ""), userId, importId: target, title: s.label, kind: s.kind, date: s.startDate, endDate: s.endDate, allDay: true, startMinutes: s.startMinutes ?? 0, endMinutes: s.endMinutes ?? 1440 }));

  // Les éléments remplacés sont marqués supprimés (conservés pour les statistiques), dans le même ordre qu'avant.
  await db.$transaction(async (tx) => {
    await tx.subject.createMany({ data: newSubjects });
    if (replace) {
      await softDelete(tx, "ScheduleBreak", { userId, importId: active ?? { not: null } });
      await softDelete(tx, "ScheduleEvent", { userId, allDay: true, importId: active ?? { not: null } });
    }
    await tx.scheduleBreak.createMany({ data: newBreaks });
    await tx.scheduleEvent.createMany({ data: specials });
    await softDelete(tx, "ScheduleEvent", { userId, id: { in: toRemove } });
    await tx.scheduleEvent.createMany({ data: creations });
    for (const u of updates) await tx.scheduleEvent.update({ where: { id: u.id }, data: u.data });
    await tx.scheduleImport.update({ where: { id: row.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), label: input.label?.trim() || null } });
    if (separate && input.activate !== false) await tx.userSettings.upsert({ where: { userId }, create: { userId, activeScheduleId: row.id }, update: { activeScheduleId: row.id } });
  });
  return { scheduleId: target, created: creations.length, updated: updates.length, removed: toRemove.length, skipped: diff.items.filter((i) => i.status === "identique").length, subjectsCreated: newSubjects.length };
}
