// ─────────────────────────────────────────────────────────────────────────────
// Agenda académique : règles pures des tâches et de la planification des séances de travail.
// ─────────────────────────────────────────────────────────────────────────────

import { addDays, daysBetween, weekday } from "./schedule";

export const TASK_TYPES = ["DEVOIR", "TD", "TP", "EXERCICE", "PROJET", "EXPOSE", "REVISION", "EXAMEN", "LECTURE", "AUTRE"] as const;
export type TaskType = (typeof TASK_TYPES)[number];
export const TASK_STATUSES = ["A_COMMENCER", "EN_COURS", "EN_ATTENTE", "TERMINE", "SOUMIS", "ANNULE"] as const;
export type StoredStatus = (typeof TASK_STATUSES)[number];
export type TaskStatus = StoredStatus | "EN_RETARD";
export const PRIORITIES = ["BASSE", "NORMALE", "HAUTE"] as const;

export interface TaskFacts {
  status: StoredStatus;
  dueDate: string;
  dueMinutes: number | null;
  requiresSubmission: boolean;
}

/**
 * Statut réel : « en retard » se déduit de la date et n'est jamais enregistré.
 * Un travail terminé mais non déposé reste en retard si une remise officielle est attendue.
 */
export function effectiveStatus(t: TaskFacts, today: string, nowMinutes: number): TaskStatus {
  if (t.status === "SOUMIS" || t.status === "ANNULE") return t.status;
  if (t.status === "TERMINE" && !t.requiresSubmission) return "TERMINE";
  const late = t.dueDate < today || (t.dueDate === today && nowMinutes >= (t.dueMinutes ?? 1440));
  return late ? "EN_RETARD" : t.status;
}

export const isOpen = (s: TaskStatus) => s !== "TERMINE" && s !== "SOUMIS" && s !== "ANNULE";

export interface PlannerPrefs {
  workStart: number;
  workEnd: number;
  maxDailyMinutes: number;
  /** Repos laissé autour des cours. */
  restMinutes: number;
  weekends: boolean;
  quietStart: number;
  quietEnd: number;
  /** Minutes avant un cours ; 0 : aucun rappel. */
  courseReminderMinutes: number;
  taskReminders: boolean;
  sessionReminders: boolean;
  /** Un seul récapitulatif des retards par jour. */
  lateReminders: boolean;
}

export const DEFAULT_PREFS: PlannerPrefs = { workStart: 17 * 60, workEnd: 21 * 60, maxDailyMinutes: 120, restMinutes: 15, weekends: true, quietStart: 22 * 60, quietEnd: 7 * 60, courseReminderMinutes: 15, taskReminders: true, sessionReminders: true, lateReminders: true };

export interface BusySlot {
  date: string;
  startMinutes: number;
  endMinutes: number;
}

export interface PlanInput {
  today: string;
  nowMinutes: number;
  dueDate: string;
  dueMinutes: number | null;
  estimatedMinutes: number;
  busy: BusySlot[];
  prefs: PlannerPrefs;
}

export interface ProposedSession extends BusySlot {
  label: string;
}

export interface PlanResult {
  feasible: boolean;
  sessions: ProposedSession[];
  plannedMinutes: number;
  missingMinutes: number;
  message: string;
}

const MIN_SESSION = 30;
const MAX_SESSION = 90;
/** Marge laissée entre la dernière séance et la tâche. */
const DUE_MARGIN = 120;
const STEP = 15;

/** Créneaux libres d'une journée dans la fenêtre de travail, repos autour des occupations déduit. */
export function freeWindows(date: string, input: Pick<PlanInput, "busy" | "prefs" | "today" | "nowMinutes" | "dueDate" | "dueMinutes">): [number, number][] {
  const { prefs } = input;
  let from = prefs.workStart;
  let to = prefs.workEnd;
  if (date === input.today) from = Math.max(from, Math.ceil((input.nowMinutes + prefs.restMinutes) / STEP) * STEP);
  if (date === input.dueDate) to = Math.min(to, (input.dueMinutes ?? 1440) - DUE_MARGIN);
  const blocks = input.busy.filter((b) => b.date === date).map((b): [number, number] => [b.startMinutes - prefs.restMinutes, b.endMinutes + prefs.restMinutes]).sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = from;
  for (const [s, e] of blocks) {
    if (s > cursor) free.push([cursor, Math.min(s, to)]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < to) free.push([cursor, to]);
  return free.filter(([s, e]) => e - s >= MIN_SESSION);
}

const LABELS = ["Préparation", "Réalisation", "Approfondissement", "Finalisation", "Vérification"];
const labelFor = (i: number, n: number) => (n === 1 ? "Réalisation" : i === 0 ? LABELS[0] : i === n - 1 ? LABELS[4] : i === n - 2 ? LABELS[3] : LABELS[1]);

/**
 * Répartit le travail avant la date limite, de façon régulière, sans toucher aux occupations ni dépasser la limite quotidienne.
 * Si le temps manque, le dit : aucune séance n'est compressée pour faire illusion.
 */
export function planStudySessions(input: PlanInput): PlanResult {
  const { prefs, today, dueDate, estimatedMinutes } = input;
  const days: string[] = [];
  for (let d = today; d <= dueDate; d = addDays(d, 1)) if (prefs.weekends || weekday(d) < 6) days.push(d);
  const empty = { sessions: [], plannedMinutes: 0, missingMinutes: estimatedMinutes };
  if (dueDate < today) return { feasible: false, ...empty, message: "La date limite est déjà passée : aucune séance ne peut être proposée." };

  const available = days.map((date) => ({ date, windows: freeWindows(date, input) })).filter((d) => d.windows.length);
  if (!available.length) return { feasible: false, ...empty, message: "Aucun créneau libre avant la date limite, avec vos préférences de travail actuelles." };

  const raw: BusySlot[] = [];
  let remaining = estimatedMinutes;
  const dailyTarget = Math.max(MIN_SESSION, Math.min(prefs.maxDailyMinutes, Math.ceil(estimatedMinutes / available.length / STEP) * STEP));
  const usedByDay = new Map<string, number>();
  // Deux passes : d'abord une charge régulière, puis la limite quotidienne si le temps manque.
  for (const cap of [dailyTarget, prefs.maxDailyMinutes]) {
    for (const day of available) {
      for (const [ws, we] of day.windows) {
        let cursor = Math.max(ws, ...raw.filter((r) => r.date === day.date && r.startMinutes < we && r.endMinutes > ws).map((r) => r.endMinutes + prefs.restMinutes));
        while (remaining > 0 && cursor < we) {
          const room = Math.min(cap - (usedByDay.get(day.date) ?? 0), we - cursor, MAX_SESSION, remaining);
          if (room < MIN_SESSION && !(room === remaining && room >= STEP && room > 0 && we - cursor >= room && cap - (usedByDay.get(day.date) ?? 0) >= room)) break;
          raw.push({ date: day.date, startMinutes: cursor, endMinutes: cursor + room });
          usedByDay.set(day.date, (usedByDay.get(day.date) ?? 0) + room);
          remaining -= room;
          cursor += room + prefs.restMinutes;
        }
        if (remaining <= 0) break;
      }
      if (remaining <= 0) break;
    }
    if (remaining <= 0) break;
  }

  const ordered = raw.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
  const sessions = ordered.map((s, i) => ({ ...s, label: labelFor(i, ordered.length) }));
  const plannedMinutes = estimatedMinutes - remaining;
  if (remaining > 0) {
    const h = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
    return { feasible: false, sessions, plannedMinutes, missingMinutes: remaining, message: `Il manque ${h(remaining)} avant la date limite : le temps libre ne suffit pas. Réduisez l'objectif, élargissez vos horaires de travail ou demandez un délai.` };
  }
  const span = daysBetween(today, dueDate);
  return { feasible: true, sessions, plannedMinutes, missingMinutes: 0, message: `${sessions.length} séance(s) réparties sur ${span + 1} jour(s), hors cours et avec une marge avant la date limite.` };
}

export interface ReminderInput {
  dueDate: string;
  dueMinutes: number | null;
  reminderMinutes: number[];
}

export function isQuiet(nowMinutes: number, prefs: Pick<PlannerPrefs, "quietStart" | "quietEnd">) {
  return prefs.quietStart > prefs.quietEnd ? nowMinutes >= prefs.quietStart || nowMinutes < prefs.quietEnd : nowMinutes >= prefs.quietStart && nowMinutes < prefs.quietEnd;
}

/** Rappels à déclencher maintenant, hors heures de tranquillité. */
export function dueReminders(task: ReminderInput, today: string, nowMinutes: number, prefs: Pick<PlannerPrefs, "quietStart" | "quietEnd">, windowMinutes = 1): number[] {
  if (isQuiet(nowMinutes, prefs)) return [];
  const left = daysBetween(today, task.dueDate) * 1440 + (task.dueMinutes ?? 1440) - nowMinutes;
  return task.reminderMinutes.filter((m) => left <= m && left > m - windowMinutes);
}
