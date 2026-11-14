"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { localClock } from "@/features/agenda/types";
import type { DashboardData } from "@/features/progress/types";

export type StreakData = NonNullable<DashboardData["streak"]>;

/** Clé partagée : le tableau de bord y dépose sa propre série pour éviter un second appel. */
export const STREAK_KEY = ["streak"] as const;

/** Série de jours de l'étudiant, partagée par tous les écrans qui l'affichent. */
export function useStreak() {
  return useQuery({
    queryKey: STREAK_KEY,
    queryFn: () => api.get<{ streak: StreakData }>(`/api/streak?date=${localClock().date}`).then((r) => r.streak),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
