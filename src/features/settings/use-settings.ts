"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/client-api";

export interface UserSettings {
  theme: string;
  textSize: "normal" | "large";
  exerciseLang: "fr" | "en";
  chatLang: "fr" | "en";
  defaultMode: "apprentissage" | "entrainement" | "examen" | "revision" | "personnalise";
  hintsEnabled: boolean;
  correctionPref: "immediate" | "final";
  explanationLevel: "simple" | "standard" | "detailed";
  maxUploadMB: number;
  notifyProgress: boolean;
  notifyRevision: boolean;
  notifyActivities: boolean;
}

export const SETTINGS_KEY = ["settings"] as const;
export const fetchSettings = () => api.get<{ settings: UserSettings }>("/api/settings").then((r) => r.settings);

/** Préférences de l'utilisateur, déjà préchargées par la mise en page : lecture partagée entre tous les modules. */
export function useSettings() {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchSettings, staleTime: 5 * 60_000 });
  const save = useCallback(
    async (patch: Partial<UserSettings>) => {
      const previous = qc.getQueryData<UserSettings>(SETTINGS_KEY);
      if (previous) qc.setQueryData(SETTINGS_KEY, { ...previous, ...patch });
      try {
        const r = await api.put<{ settings: UserSettings }>("/api/settings", patch);
        qc.setQueryData(SETTINGS_KEY, r.settings);
        return r.settings;
      } catch (e) {
        qc.setQueryData(SETTINGS_KEY, previous);
        throw e;
      }
    },
    [qc],
  );
  return { settings: data ?? null, error, isLoading, save };
}
