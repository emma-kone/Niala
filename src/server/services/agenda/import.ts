import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { normalizeSubjectName } from "@/lib/subjects";
import { AiCallError, AiQuotaError, AiUnavailableError } from "@/server/ai/provider";
import { addDays, breakOverlap, diffImport, expandEvents, findConflicts, formatMinutes, isDate, occurrenceDates, validateTimes, weekday, type ExistingCourse, type Recurrence, type ScheduleEventRecord, type ScheduleOverrideRecord, type WeekPattern } from "@/server/domain/schedule";
import { getStorage, newStorageKey } from "@/server/storage";
import { weekSwapOf } from "./agenda";
import { extractContent, identifyFile } from "./extract";
import { interpretSchedule, normalizeDraft, type DraftEvent } from "./interpret";

// ─────────────────────────────────────────────────────────────────────────────
// Import d'un emploi du temps, de bout en bout : fichier conservé → contenu extrait → interprétation par l'IA →
// brouillon soumis à l'étudiant → enregistrement après sa validation uniquement.
// ─────────────────────────────────────────────────────────────────────────────

const HORIZON_DAYS = 16 * 7;
const SUBJECT_COLORS = ["#8b5cf6", "#0ea5e9", "#f59e0b", "#10b981", "#ec4899", "#6366f1", "#14b8a6", "#ef4444"];

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

async function existingCourses(userId: string): Promise<ExistingCourse[]> {
  const rows = await db.scheduleEvent.findMany({ where: { userId, recurrence: "WEEKLY" }, select: { id: true, title: true, date: true, startMinutes: true, endMinutes: true, room: true, teacher: true, weekPattern: true, importId: true } });
  return rows.map((r) => ({ ...r, weekPattern: r.weekPattern as WeekPattern }));
}

function withDiff(drafts: DraftEvent[], existing: ExistingCourse[]) {
  const { items, removed } = diffImport(drafts.filter((d) => d.recurring), existing);
  const status = new Map(items.map((i) => [i.draft.id, i]));
  return {
    events: drafts.map((d) => ({ ...d, status: status.get(d.id)?.status ?? "nouveau", changes: status.get(d.id)?.changes ?? [] })),
    removed: removed.map((r) => ({ id: r.id, title: r.title, day: weekday(r.date), startMinutes: r.startMinutes, endMinutes: r.endMinutes })),
  };
}

export async function startImport(userId: string, file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.replace(/[\\/\0]/g, "_").slice(0, 200);
  const { extension, mime } = identifyFile(name, bytes);
  const content = await extractContent(extension, bytes);
  const subjects = await db.subject.findMany({ where: { userId }, select: { id: true, name: true, color: true }, orderBy: { name: "asc" } });

  let raw;
  try {
    raw = await interpretSchedule(userId, content);
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    if (e instanceof AiUnavailableError) throw new ApiHttpError("Le service d'IA n'est pas configuré : l'analyse automatique est indisponible.", 503);
    if (e instanceof AiCallError) throw new ApiHttpError("L'analyse du document n'a pas abouti. Réessayez dans un instant.", 502);
    throw e;
  }
  const drafts = normalizeDraft(raw, subjects, content.kind === "text" ? content.text : null);
  const warnings = [...content.warnings, ...(raw.avertissements ?? [])];
  if (!drafts.length) warnings.push("Aucun cours n'a été identifié dans ce document.");

  const id = randomUUID().replace(/-/g, "");
  const storageKey = newStorageKey(userId, id, 1, randomBytes(8).toString("hex"));
  await getStorage().put(storageKey, bytes, mime);
  await db.scheduleImport.create({ data: { id, userId, fileName: name, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storageKey, draft: asJson(drafts), warnings: asJson(warnings) } });
  return { id, fileName: name, warnings, subjects, ...withDiff(drafts, await existingCourses(userId)) };
}

async function ownedImport(userId: string, id: string) {
  const row = await db.scheduleImport.findFirst({ where: { id, userId } });
  if (!row) throw new ApiHttpError("Import introuvable.", 404);
  return row;
}

export async function listImports(userId: string) {
  const imports = await db.scheduleImport.findMany({ where: { userId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, fileName: true, createdAt: true, confirmedAt: true, _count: { select: { events: true } } } });
  return { imports };
}

/** Abandon d'un import non validé : le fichier et le brouillon sont supprimés. */
export async function cancelImport(userId: string, id: string) {
  const row = await ownedImport(userId, id);
  if (row.status === "CONFIRMED") throw new ApiHttpError("Cet import a déjà été validé.", 409);
  await db.scheduleImport.delete({ where: { id: row.id } });
  await getStorage().remove([row.storageKey]).catch(() => undefined);
  return { ok: true };
}

export async function importFile(userId: string, id: string) {
  const row = await ownedImport(userId, id);
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
  weekPattern: z.enum(["ALL", "A", "B"]),
  recurring: z.boolean(),
  confidence: z.enum(["elevee", "moyenne", "faible"]).optional(),
  subjectId: z.string().min(1).nullable().optional(),
  createSubject: z.boolean().optional(),
});

export const confirmSchema = z.object({
  mode: z.enum(["add", "replace"]),
  startDate: z.string().refine(isDate, "Date de début invalide."),
  events: z.array(confirmedEvent).min(1, "Aucun cours à enregistrer.").max(120),
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

  const [subjects, existing, allEvents, swap] = await Promise.all([
    db.subject.findMany({ where: { userId }, select: { id: true, name: true } }),
    existingCourses(userId),
    db.scheduleEvent.findMany({ where: { userId }, include: { overrides: true } }),
    weekSwapOf(userId),
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
    const date = e.date ?? firstDateOn(input.startDate, e.day);
    return occurrenceDates({ date, recurrence: e.recurring ? "WEEKLY" : "NONE", until: null, weekPattern: e.weekPattern }, date, addDays(date, HORIZON_DAYS), swap).map((d) => ({ date: d, startMinutes: e.startMinutes, endMinutes: e.endMinutes, title: e.title, key: e.id }));
  };

  if (!input.force) {
    const planned = [...toCreate, ...toUpdate.map((i) => i.draft)];
    const pause = planned.find((e) => breakOverlap(e.startMinutes, e.endMinutes));
    const records = allEvents.filter((e) => !released.has(e.id)).map((e): ScheduleEventRecord => ({ ...e, recurrence: e.recurrence as Recurrence, weekPattern: e.weekPattern as WeekPattern }));
    const overrides = allEvents.flatMap((e): ScheduleOverrideRecord[] => e.overrides);
    const slots = planned.flatMap(slotsOf);
    const horizonEnd = addDays(input.startDate, HORIZON_DAYS + 14);
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
  const newSubjects: { id: string; userId: string; name: string; color: string }[] = [];
  const subjectFor = (e: (typeof input.events)[number]): string | null => {
    if (e.subjectId) return e.subjectId;
    if (!e.createSubject) return null;
    const norm = normalizeSubjectName(e.title);
    let sid = known.get(norm);
    if (!sid) {
      sid = randomUUID().replace(/-/g, "");
      known.set(norm, sid);
      newSubjects.push({ id: sid, userId, name: e.title.trim().replace(/\s+/g, " "), color: SUBJECT_COLORS[newSubjects.length % SUBJECT_COLORS.length] });
    }
    return sid;
  };

  const creations = toCreate.map((e) => ({
    userId,
    importId: row.id,
    subjectId: subjectFor(e),
    title: e.title,
    date: e.date ?? firstDateOn(input.startDate, e.day),
    startMinutes: e.startMinutes,
    endMinutes: e.endMinutes,
    recurrence: e.recurring ? "WEEKLY" : "NONE",
    weekPattern: e.recurring ? e.weekPattern : "ALL",
    room: e.room || null,
    teacher: e.teacher || null,
    groupName: e.groupName || null,
    confidence: e.confidence ?? null,
    id: randomUUID().replace(/-/g, ""),
  }));
  const updates = toUpdate.map((i) => ({ id: i.existingId!, data: { startMinutes: i.draft.startMinutes, endMinutes: i.draft.endMinutes, ...(i.draft.room ? { room: i.draft.room } : {}), ...(i.draft.teacher ? { teacher: i.draft.teacher } : {}), importId: row.id, subjectId: subjectFor(i.draft) ?? undefined } }));

  await db.$transaction([
    db.subject.createMany({ data: newSubjects }),
    db.scheduleEvent.deleteMany({ where: { userId, id: { in: toRemove } } }),
    db.scheduleEvent.createMany({ data: creations }),
    ...updates.map((u) => db.scheduleEvent.update({ where: { id: u.id }, data: u.data })),
    db.scheduleImport.update({ where: { id: row.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } }),
  ]);
  return { created: creations.length, updated: updates.length, removed: toRemove.length, skipped: diff.items.filter((i) => i.status === "identique").length, subjectsCreated: newSubjects.length };
}
