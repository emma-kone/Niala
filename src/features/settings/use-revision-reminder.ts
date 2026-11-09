"use client";

import { useEffect } from "react";
import { api } from "@/lib/client-api";
import { notify } from "@/components/notifications";

const STORE = "niala-revision-reminder";
const DELAY_MS = 8_000;

/** Rappel de révision : au plus un par jour, à partir des recommandations déjà calculées par la progression. */
export function useRevisionReminder(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      const today = new Date().toLocaleDateString("sv");
      try {
        if (localStorage.getItem(STORE) === today) return;
        localStorage.setItem(STORE, today);
      } catch {
        return; // sans mémoire locale, on ne risque pas de répéter le rappel à chaque ouverture
      }
      api
        .get<{ recommendations: { title: string; text: string }[] }>("/api/recommendations")
        .then((r) => {
          const first = r.recommendations[0];
          if (first) notify({ title: `À réviser : ${first.title}`, description: first.text, variant: "info" });
        })
        .catch(() => undefined);
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled]);
}
