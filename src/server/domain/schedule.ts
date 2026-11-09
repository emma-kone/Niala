// ─────────────────────────────────────────────────────────────────────────────
// Emploi du temps : règles pures. Les horaires sont des minutes depuis minuit et les dates des chaînes
// « AAAA-MM-JJ » : un cours à 8 h 30 reste à 8 h 30 quel que soit le fuseau du serveur ou de l'appareil.
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_DURATION = 15;
/** Fenêtre affichée quand la période ne contient encore aucun cours. */
export const EMPTY_GRID = { start: 8 * 60, end: 18 * 60 };

export interface BreakRecord {
  id?: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  /** null : tous les jours. */
  weekday: number | null;
}

export type Recurrence = "NONE" | "WEEKLY" | "DATES";
export type WeekPattern = "ALL" | "A" | "B";

export interface ScheduleEventRecord {
  id: string;
  subjectId: string | null;
  title: string;
  kind: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  recurrence: Recurrence;
  until: string | null;
  weekPattern: WeekPattern;
  /** Séances précises, pour un cours présent seulement certaines semaines. */
  dates: string[] | null;
  endDate: string | null;
  allDay: boolean;
  code: string | null;
  sessionType: string | null;
  room: string | null;
  teacher: string | null;
  groupName: string | null;
  description: string | null;
  importId: string | null;
  confidence: string | null;
}

export interface ScheduleOverrideRecord {
  eventId: string;
  date: string;
  cancelled: boolean;
  newDate: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  subjectId: string | null;
  title: string | null;
  room: string | null;
  teacher: string | null;
  description: string | null;
}

export interface Occurrence extends Omit<ScheduleEventRecord, "id" | "date"> {
  /** Identifiant stable de cette séance : série + date d'origine. */
  key: string;
  eventId: string;
  /** Date d'origine dans la série (sert à modifier une seule séance). */
  originalDate: string;
  date: string;
  overridden: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toUtc = (date: string) => new Date(`${date}T00:00:00Z`);
const fromUtc = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUtc(toUtc(s)) === s;

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Jour de la semaine : 1 = lundi … 7 = dimanche. */
export function weekday(date: string): number {
  return ((toUtc(date).getUTCDay() + 6) % 7) + 1;
}

export const mondayOf = (date: string) => addDays(date, 1 - weekday(date));
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);

/** Numéro de semaine ISO. */
export function isoWeek(date: string): number {
  const thursday = addDays(date, 4 - weekday(date));
  const yearStart = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor(daysBetween(yearStart, thursday) / 7) + 1;
}

/** Semaine A = semaine ISO impaire ; `swap` inverse la convention pour coller à celle de l'établissement. */
export function weekLetter(date: string, swap = false): "A" | "B" {
  const odd = isoWeek(date) % 2 === 1;
  return odd !== swap ? "A" : "B";
}

export const formatMinutes = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Lit « 8:30 », « 08h30 », « 8h », « 14 h 15 ». Renvoie null si l'heure n'est pas lisible. */
export function parseTime(value: string | null | undefined): number | null {
  const m = /^\s*(\d{1,2})\s*[:hH.]\s*(\d{2})?\s*$/.exec(value ?? "") ?? /^\s*(\d{1,2})\s*$/.exec(value ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function validateTimes(start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1440) return "Horaire invalide.";
  if (end <= start) return "L'heure de fin doit être après l'heure de début.";
  if (end - start < MIN_DURATION) return `Une séance dure au moins ${MIN_DURATION} minutes.`;
  return null;
}

/** Pause touchée par un créneau parmi celles de l'étudiant. */
export function breakOverlap(start: number, end: number, breaks: BreakRecord[], date?: string) {
  return breaks.find((b) => start < b.endMinutes && end > b.startMinutes && (b.weekday === null || !date || b.weekday === weekday(date))) ?? null;
}

export interface GridGeometry {
  start: number;
  end: number;
  /** Heures à inscrire sur l'axe : les vraies bornes des cours et des pauses. */
  marks: number[];
}

/**
 * Grille calculée à partir des horaires réels de la période : début, fin et repères ne sont jamais prédéfinis.
 * Les repères trop proches pour rester lisibles (minGap, en minutes) sont regroupés.
 */
export function computeGrid(slots: { startMinutes: number; endMinutes: number }[], breaks: { startMinutes: number; endMinutes: number }[] = [], minGap = 15): GridGeometry {
  if (!slots.length) return { start: EMPTY_GRID.start, end: EMPTY_GRID.end, marks: [EMPTY_GRID.start, EMPTY_GRID.end] };
  const start = Math.min(...slots.map((s) => s.startMinutes));
  const end = Math.max(...slots.map((s) => s.endMinutes));
  const inside = breaks.filter((b) => b.startMinutes >= start && b.endMinutes <= end);
  const all = [...new Set([...slots, ...inside].flatMap((s) => [s.startMinutes, s.endMinutes]))].sort((a, b) => a - b);
  const marks: number[] = [];
  for (const m of all) if (!marks.length || m - marks[marks.length - 1] >= minGap || m === end) marks.push(m);
  return { start, end, marks };
}

/** Position et hauteur d'un créneau, proportionnelles aux minutes réelles. */
export function slotBox(slot: { startMinutes: number; endMinutes: number }, gridStart: number, pixelsPerHour: number) {
  const perMinute = pixelsPerHour / 60;
  return { top: (slot.startMinutes - gridStart) * perMinute, height: (slot.endMinutes - slot.startMinutes) * perMinute };
}

/**
 * Pauses implicites d'un document : intervalles réguliers entre deux créneaux, présents au moins deux jours.
 * Une longue absence de cours n'est pas une pause. Une pause absente de certains jours de cours n'y est pas appliquée.
 */
export function deriveBreaks(slots: { day: number | null; startMinutes: number | null; endMinutes: number | null }[], maxGap = 150): BreakRecord[] {
  const byDay = new Map<number, [number, number][]>();
  for (const s of slots) {
    if (s.day === null || s.startMinutes === null || s.endMinutes === null) continue;
    byDay.set(s.day, [...(byDay.get(s.day) ?? []), [s.startMinutes, s.endMinutes]]);
  }
  const daysOf = new Map<string, number[]>();
  for (const [weekdayNumber, day] of byDay) {
    const unique = [...new Map(day.map((x) => [x.join("-"), x])).values()].sort((a, b) => a[0] - b[0]);
    const seen = new Set<string>();
    for (let i = 0; i + 1 < unique.length; i++) {
      const [from, to] = [unique[i][1], unique[i + 1][0]];
      if (to > from && to - from <= maxGap) seen.add(`${from}-${to}`);
    }
    seen.forEach((k) => daysOf.set(k, [...(daysOf.get(k) ?? []), weekdayNumber]));
  }
  return [...daysOf]
    .filter(([, days]) => days.length >= 2)
    .flatMap(([k, days]) => {
      const [startMinutes, endMinutes] = k.split("-").map(Number);
      const label = endMinutes - startMinutes >= 60 ? "Pause déjeuner" : "Pause";
      return (days.length === byDay.size ? [null] : days).map((weekday): BreakRecord => ({ label, startMinutes, endMinutes, weekday }));
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || (a.weekday ?? 0) - (b.weekday ?? 0));
}

function appliesOn(event: Pick<ScheduleEventRecord, "weekPattern">, date: string, swap: boolean) {
  return event.weekPattern === "ALL" || event.weekPattern === weekLetter(date, swap);
}

/** Dates d'origine d'un événement sur une période (bornes incluses). */
export function occurrenceDates(event: Pick<ScheduleEventRecord, "date" | "recurrence" | "until" | "weekPattern"> & { dates?: string[] | null; endDate?: string | null }, from: string, to: string, swap = false): string[] {
  if (event.recurrence === "NONE") {
    const out: string[] = [];
    for (let d = event.date; d <= (event.endDate ?? event.date); d = addDays(d, 1)) if (d >= from && d <= to) out.push(d);
    return out;
  }
  if (event.recurrence === "DATES") return (event.dates ?? []).filter((d) => d >= from && d <= to).sort();
  const out: string[] = [];
  const gap = daysBetween(event.date, from);
  let cursor = gap > 0 ? addDays(event.date, Math.ceil(gap / 7) * 7) : event.date;
  const last = event.until && event.until < to ? event.until : to;
  while (cursor <= last) {
    if (appliesOn(event, cursor, swap)) out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

/** Séances réelles d'une période, modifications ponctuelles appliquées, triées par date puis heure. */
export function expandEvents(events: ScheduleEventRecord[], overrides: ScheduleOverrideRecord[], from: string, to: string, swap = false): Occurrence[] {
  const byEvent = new Map<string, ScheduleOverrideRecord[]>();
  for (const o of overrides) byEvent.set(o.eventId, [...(byEvent.get(o.eventId) ?? []), o]);
  const out: Occurrence[] = [];
  for (const { id, date: firstDate, ...base } of events) {
    const own = byEvent.get(id) ?? [];
    const originals = new Set(occurrenceDates({ ...base, date: firstDate }, from, to, swap));
    // Une séance déplacée peut venir d'une date située hors de la période.
    for (const o of own) if (o.newDate && o.newDate >= from && o.newDate <= to) originals.add(o.date);
    for (const originalDate of originals) {
      const o = own.find((x) => x.date === originalDate);
      if (o?.cancelled) continue;
      const date = o?.newDate ?? originalDate;
      if (date < from || date > to) continue;
      out.push({
        ...base,
        key: `${id}:${originalDate}`,
        eventId: id,
        originalDate,
        date,
        startMinutes: o?.startMinutes ?? base.startMinutes,
        endMinutes: o?.endMinutes ?? base.endMinutes,
        subjectId: o?.subjectId ?? base.subjectId,
        title: o?.title ?? base.title,
        room: o?.room ?? base.room,
        teacher: o?.teacher ?? base.teacher,
        description: o?.description ?? base.description,
        overridden: !!o,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
}

export const overlaps = (a: { startMinutes: number; endMinutes: number }, b: { startMinutes: number; endMinutes: number }) => a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;

/** Séances qui chevauchent un créneau. Deux cours qui se suivent exactement ne se chevauchent pas. */
export function findConflicts(slot: { date: string; startMinutes: number; endMinutes: number }, others: Pick<Occurrence, "key" | "date" | "title" | "startMinutes" | "endMinutes">[], ignoreKey?: string) {
  return others.filter((o) => o.key !== ignoreKey && o.date === slot.date && overlaps(slot, o));
}

/** Présentation d'une journée : séances, pauses et position de chaque séance par rapport à maintenant. */
export function classifyOccurrence(o: { date: string; startMinutes: number; endMinutes: number }, today: string, nowMinutes: number): "past" | "current" | "upcoming" {
  if (o.date < today) return "past";
  if (o.date > today) return "upcoming";
  if (o.endMinutes <= nowMinutes) return "past";
  return o.startMinutes <= nowMinutes ? "current" : "upcoming";
}

// ── Imports successifs ───────────────────────────────────────────────────────

export interface DraftCourse {
  code?: string | null;
  dates?: string[] | null;
  title: string;
  day: number | null;
  startMinutes: number | null;
  endMinutes: number | null;
  room: string | null;
  teacher: string | null;
  weekPattern: WeekPattern;
}

export interface ExistingCourse {
  id: string;
  title: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  room: string | null;
  teacher: string | null;
  weekPattern: WeekPattern;
  importId: string | null;
  code?: string | null;
  dates?: string[] | null;
}

export type DraftStatus = "nouveau" | "identique" | "modifie";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const sameSubjectName = (a: string, b: string) => fold(a) === fold(b);

/**
 * Compare un import à l'agenda : ce qui est nouveau, identique (ignoré pour éviter les doublons) ou modifié,
 * et les cours issus d'anciens imports absents du nouveau document.
 */
export function diffImport<T extends DraftCourse>(drafts: T[], existing: ExistingCourse[]) {
  const unused = new Set(existing.map((e) => e.id));
  const take = (test: (e: ExistingCourse) => boolean) => {
    const found = existing.find((e) => unused.has(e.id) && test(e));
    if (found) unused.delete(found.id);
    return found ?? null;
  };
  const sameCourse = (d: T, e: ExistingCourse) => (d.code && e.code ? d.code === e.code : fold(e.title) === fold(d.title));
  const sameSlot = (d: T, e: ExistingCourse) => sameCourse(d, e) && weekday(e.date) === d.day && e.weekPattern === d.weekPattern;
  // Deux passes : les correspondances exactes d'abord, pour qu'un cours identique ne soit jamais pris pour une modification.
  const exact = new Map<T, ExistingCourse>();
  for (const d of drafts) {
    const e = take((x) => sameSlot(d, x) && x.startMinutes === d.startMinutes && x.endMinutes === d.endMinutes);
    if (e) exact.set(d, e);
  }
  const items = drafts.map((draft) => {
    const same = exact.get(draft);
    if (same) {
      const sameDates = JSON.stringify([...(same.dates ?? [])].sort()) === JSON.stringify([...(draft.dates ?? [])].sort());
      const changes = [same.room !== draft.room && draft.room ? "salle" : null, same.teacher !== draft.teacher && draft.teacher ? "enseignant" : null, draft.dates && !sameDates ? "semaines" : null].filter((x): x is string => !!x);
      return { draft, status: (changes.length ? "modifie" : "identique") as DraftStatus, existingId: same.id, changes };
    }
    const moved = take((x) => sameSlot(draft, x));
    return moved ? { draft, status: "modifie" as DraftStatus, existingId: moved.id, changes: ["horaire"] } : { draft, status: "nouveau" as DraftStatus, existingId: null as string | null, changes: [] as string[] };
  });
  return { items, removed: existing.filter((e) => unused.has(e.id) && e.importId) };
}
