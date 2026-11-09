"use client";

import { useEffect } from "react";
import { notify } from "@/components/notifications";
import { api } from "@/lib/client-api";
import { dueReminders, isOpen, isQuiet, type PlannerPrefs } from "@/server/domain/academic";
import { addDays, formatMinutes } from "@/server/domain/schedule";
import { dueLabel, localClock, type AgendaData, type OccurrenceDto, type TaskDto } from "./types";

const REFRESH_MS = 5 * 60_000;
const CHECK_MS = 30_000;
const SESSION_BEFORE = 10;
/** Un rappel manqué parce que Niala était fermé reste valable une heure. */
const CATCH_UP = 60;
/** Jamais plus de trois notifications à la fois. */
const MAX_AT_ONCE = 3;
const STORE = "niala-reminders-sent";

function readSent(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSent(sent: Record<string, string>, today: string) {
  try {
    const limit = addDays(today, -14);
    localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(Object.entries(sent).filter(([, d]) => d >= limit))));
  } catch {
    // Stockage indisponible : les rappels restent dédoublonnés pour la session en cours.
  }
}

/** Rappels des cours, séances et tâches, selon les préférences et jamais pendant les heures de tranquillité. */
export function useCourseReminders(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let courses: OccurrenceDto[] = [];
    let tasks: TaskDto[] = [];
    let prefs: PlannerPrefs | null = null;
    const sent = readSent();

    const refresh = () => {
      const { date, minutes } = localClock();
      api.get<AgendaData>(`/api/agenda?from=${date}&to=${date}`).then((r) => (courses = r.occurrences.filter((o) => !o.allDay))).catch(() => undefined);
      api.get<{ tasks: TaskDto[] }>(`/api/agenda/tasks?date=${date}&minutes=${minutes}`).then((r) => (tasks = r.tasks)).catch(() => undefined);
      api.get<{ preferences: PlannerPrefs }>("/api/agenda/preferences").then((r) => (prefs = r.preferences)).catch(() => undefined);
    };

    const check = () => {
      if (!prefs) return;
      const { date, minutes } = localClock();
      if (isQuiet(minutes, prefs)) return;
      let shown = 0;
      const send = (key: string, message: Parameters<typeof notify>[0]) => {
        if (shown >= MAX_AT_ONCE || sent[key]) return;
        sent[key] = date;
        shown++;
        notify(message);
      };
      if (prefs.courseReminderMinutes > 0) {
        for (const o of courses) {
          const left = o.startMinutes - minutes;
          if (o.date === date && left > 0 && left <= prefs.courseReminderMinutes) send(`c:${o.key}`, { title: `${o.title} dans ${left} min`, description: `${formatMinutes(o.startMinutes)} – ${formatMinutes(o.endMinutes)}${o.room ? ` · ${o.room}` : ""}`, variant: "info" });
        }
      }
      const open = tasks.filter((t) => isOpen(t.status));
      if (prefs.sessionReminders) {
        for (const t of open) {
          for (const s of t.sessions) {
            const left = s.startMinutes - minutes;
            if (s.date === date && !s.done && left > 0 && left <= SESSION_BEFORE) send(`s:${s.id}`, { title: `Séance de travail dans ${left} min`, description: t.title, variant: "info" });
          }
        }
      }
      if (prefs.taskReminders) {
        for (const t of open) {
          if (t.status === "EN_RETARD") continue;
          for (const m of dueReminders({ dueDate: t.dueDate, dueMinutes: t.dueMinutes, reminderMinutes: t.reminderMinutes ?? [] }, date, minutes, prefs, CATCH_UP)) send(`t:${t.id}:${m}`, { title: `Tâche : ${t.title}`, description: `Pour ${dueLabel(t)}`, variant: "info" });
        }
      }
      const late = open.filter((t) => t.status === "EN_RETARD");
      if (prefs.lateReminders && late.length) send(`late:${date}`, { title: late.length === 1 ? "1 tâche en retard" : `${late.length} tâches en retard`, description: late.slice(0, 3).map((t) => t.title).join(" · "), variant: "warning" });
      if (shown) writeSent(sent, date);
    };

    refresh();
    const r = setInterval(refresh, REFRESH_MS);
    const c = setInterval(check, CHECK_MS);
    return () => {
      clearInterval(r);
      clearInterval(c);
    };
  }, [enabled]);
}
