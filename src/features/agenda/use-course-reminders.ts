"use client";

import { useEffect } from "react";
import { notify } from "@/components/notifications";
import { api } from "@/lib/client-api";
import { formatMinutes } from "@/server/domain/schedule";
import { localClock, type AgendaData, type OccurrenceDto } from "./types";

const REMIND_BEFORE = 15;
const REFRESH_MS = 5 * 60_000;
const CHECK_MS = 30_000;

/** Prévient une fois, quinze minutes avant, à partir des mêmes données que l'agenda. */
export function useCourseReminders(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let today: OccurrenceDto[] = [];
    const seen = new Set<string>();
    const refresh = () => {
      const { date } = localClock();
      api.get<AgendaData>(`/api/agenda?from=${date}&to=${date}`).then((r) => (today = r.occurrences)).catch(() => undefined);
    };
    const check = () => {
      const { minutes } = localClock();
      for (const o of today) {
        const left = o.startMinutes - minutes;
        if (left <= 0 || left > REMIND_BEFORE || seen.has(o.key)) continue;
        seen.add(o.key);
        notify({ title: `${o.title} dans ${left} min`, description: `${formatMinutes(o.startMinutes)} – ${formatMinutes(o.endMinutes)}${o.room ? ` · ${o.room}` : ""}`, variant: "info" });
      }
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
