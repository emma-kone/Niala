"use client";

import { useEffect } from "react";
import { notify } from "@/components/notifications";
import { announceDataChanged } from "@/hooks/use-background-refresh";
import { api } from "@/lib/client-api";
import { DEFAULT_PREFS, dueReminders, isOpen } from "@/server/domain/academic";
import { addDays, daysBetween, formatMinutes } from "@/server/domain/schedule";
import { dueLabel, localClock, type AgendaData, type OccurrenceDto, type TaskDto } from "./types";

// Rappels de l'agenda, actifs dans tout Niala : tâches à l'heure prévue (ou avant, selon le rappel choisi), séances de
// travail, cours de l'emploi du temps suivi et tâches en retard. Chaque rappel s'affiche dans Niala et, si l'étudiant l'a
// autorisé, comme notification du système (visible même quand l'onglet Niala est en arrière-plan).

const REFRESH_MS = 5 * 60_000;
/** Les rappels ne sont pas urgents à l'ouverture : la page consultée passe d'abord. */
const FIRST_LOAD_DELAY_MS = 3_000;
const CHECK_MS = 5_000;
const SESSION_BEFORE = 10;
/** Un rappel manqué parce que Niala était fermé reste valable une heure. */
const CATCH_UP = 60;
/** Jamais plus de trois notifications à la fois. */
const MAX_AT_ONCE = 3;
const STORE = "niala-reminders-sent";
/** Événement envoyé quand une tâche est créée ou modifiée : les rappels sont relus aussitôt. */
export const TASKS_CHANGED = "niala:tasks-changed";
/** Plus d'heures de tranquillité réglables : un rappel demandé par l'étudiant part à l'heure choisie. */
const NO_QUIET = { quietStart: 0, quietEnd: 0 };

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

/** Notification du système, si l'étudiant l'a autorisée (sinon seul le message dans Niala s'affiche). */
function systemNotify(title: string, body: string | undefined, tag: string) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const n = new Notification(title, { body, tag, icon: "/icon.png" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Certains navigateurs (iOS hors application installée) refusent les notifications : le message dans Niala suffit.
  }
}

/** Une tâche a changé : les rappels de cet onglet sont relus, et les autres onglets de Niala sont prévenus. */
export function announceTasksChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASKS_CHANGED));
  announceDataChanged("tasks");
}

export function useCourseReminders(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let courses: OccurrenceDto[] = [];
    let tasks: TaskDto[] = [];
    let loaded = false;
    const sent = readSent();

    const refresh = () => {
      const { date, minutes } = localClock();
      void Promise.all([
        api.get<AgendaData>(`/api/agenda?from=${date}&to=${date}`).then((r) => (courses = r.occurrences.filter((o) => !o.allDay))).catch(() => undefined),
        api.get<{ tasks: TaskDto[] }>(`/api/agenda/tasks?date=${date}&minutes=${minutes}`).then((r) => (tasks = r.tasks)).catch(() => undefined),
      ]).then(() => {
        loaded = true;
        check();
      });
    };

    const check = () => {
      if (!loaded) return;
      const { date, minutes } = localClock();
      let shown = 0;
      const send = (key: string, title: string, description: string | undefined, variant: "info" | "warning") => {
        if (shown >= MAX_AT_ONCE || sent[key]) return;
        sent[key] = date;
        shown++;
        notify({ title, description, variant, durationMs: 15_000 });
        systemNotify(title, description, key);
      };
      const open = tasks.filter((t) => isOpen(t.status));
      for (const t of open) {
        if (t.status === "EN_RETARD" && !(t.reminderMinutes ?? []).includes(0)) continue;
        for (const m of dueReminders({ dueDate: t.dueDate, dueMinutes: t.dueMinutes, reminderMinutes: t.reminderMinutes ?? [] }, date, minutes, NO_QUIET, CATCH_UP)) {
          const atTime = m === 0;
          send(`t:${t.id}:${m}:${t.dueDate}:${t.dueMinutes ?? ""}`, atTime ? `C'est l'heure : ${t.title}` : `Rappel : ${t.title}`, atTime ? [t.description, t.estimatedMinutes ? `Durée prévue : ${t.estimatedMinutes} min` : null].filter(Boolean).join(" · ") || undefined : `Prévu ${dueLabel(t)}`, "info");
        }
        for (const s of t.sessions) {
          const left = s.startMinutes - minutes;
          if (s.date === date && !s.done && left > 0 && left <= SESSION_BEFORE) send(`s:${s.id}`, `Séance de travail dans ${left} min`, t.title, "info");
        }
      }
      for (const o of courses) {
        const left = o.startMinutes - minutes;
        if (o.date === date && left > 0 && left <= DEFAULT_PREFS.courseReminderMinutes) send(`c:${o.key}`, `${o.title} dans ${left} min`, `${formatMinutes(o.startMinutes)} – ${formatMinutes(o.endMinutes)}${o.room ? ` · ${o.room}` : ""}`, "info");
      }
      // « En retard » seulement une fois passé le délai du rappel à l'heure prévue, pour ne pas doubler ce rappel.
      const late = open.filter((t) => t.status === "EN_RETARD" && daysBetween(date, t.dueDate) * 1440 + (t.dueMinutes ?? 1440) - minutes < -CATCH_UP);
      if (late.length) send(`late:${date}`, late.length === 1 ? "1 tâche en retard" : `${late.length} tâches en retard`, late.slice(0, 3).map((t) => t.title).join(" · "), "warning");
      if (shown) writeSent(sent, date);
    };

    const first = setTimeout(refresh, FIRST_LOAD_DELAY_MS);
    const r = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    const c = setInterval(check, CHECK_MS);
    window.addEventListener(TASKS_CHANGED, refresh);
    // Tâche ou emploi du temps modifié dans un autre onglet : les rappels de celui-ci sont relus aussi.
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("niala-data");
      channel.onmessage = (e: MessageEvent<{ topic?: string }>) => {
        if (e.data?.topic === "tasks" || e.data?.topic === "agenda") refresh();
      };
    } catch {
      channel = null;
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      channel?.close();
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(first);
      clearInterval(r);
      clearInterval(c);
      window.removeEventListener(TASKS_CHANGED, refresh);
    };
  }, [enabled]);
}
