// Série de jours consécutifs d'activité : règles pures, sans accès à la base.
//
// Cadre retenu :
//  - un « jour » est la date de l'appareil de l'étudiant (AAAA-MM-JJ), comme pour le tableau de bord ; elle est enregistrée
//    telle quelle, le serveur ne convertit aucun fuseau. Le jour bascule donc à minuit, heure de l'appareil ;
//  - il suffit d'une activité dans la journée (peu importe le nombre) : les doublons d'un même jour comptent une fois ;
//  - la série en cours reste vivante tant que la journée d'aujourd'hui n'est pas terminée : si hier est fait mais pas
//    aujourd'hui, elle est « à poursuivre » ; elle retombe à zéro dès qu'un jour entier a été manqué ;
//  - le record est la plus longue série jamais atteinte ; il n'est jamais diminué par une rupture.

import { addDays, isDate } from "./schedule";

export interface StreakView {
  /** Jours consécutifs jusqu'à aujourd'hui (ou jusqu'à hier si aujourd'hui n'est pas encore fait). */
  current: number;
  /** Plus longue série atteinte. */
  longest: number;
  /** Au moins une activité aujourd'hui. */
  doneToday: boolean;
  /** Série en cours qui sera perdue si rien n'est fait avant la fin de la journée. */
  atRisk: boolean;
  /** Dernier jour d'activité (au plus aujourd'hui). */
  lastDay: string | null;
  /** Nombre total de jours actifs. */
  totalDays: number;
  /** Les sept derniers jours, du plus ancien à aujourd'hui. */
  week: { date: string; active: boolean }[];
}

/**
 * Date retenue pour une activité : celle de l'appareil, tant qu'elle est à un jour près de la date du serveur
 * (les fuseaux vont de UTC-12 à UTC+14). Au-delà, ou si elle est absente ou invalide, on retombe sur la date du serveur.
 */
export function resolveActivityDay(claimed: string | null | undefined, serverNow: Date): string {
  const utc = serverNow.toISOString().slice(0, 10);
  if (!claimed || !isDate(claimed)) return utc;
  return claimed >= addDays(utc, -1) && claimed <= addDays(utc, 1) ? claimed : utc;
}

/** Plus longue suite de jours consécutifs dans des dates triées et uniques. */
function longestRun(sorted: string[]): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

export function computeStreak(activeDays: Iterable<string>, today: string): StreakView {
  const days = [...new Set([...activeDays].filter(isDate))].sort();
  const set = new Set(days);
  const doneToday = set.has(today);
  // Les jours situés après « aujourd'hui » (changement de fuseau vers l'ouest) ne prolongent pas la série en cours.
  let cursor = doneToday ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const past = days.filter((d) => d <= today);
  const week = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    return { date, active: set.has(date) };
  });
  return {
    current,
    longest: Math.max(longestRun(days), current),
    doneToday,
    atRisk: current > 0 && !doneToday,
    lastDay: past.length ? past[past.length - 1] : null,
    totalDays: days.length,
    week,
  };
}

/** Message sobre, adapté à l'état de la série. */
export function streakMessage(s: Pick<StreakView, "current" | "longest" | "doneToday" | "atRisk" | "totalDays">): string {
  if (s.totalDays === 0) return "Ouvrez un cours ou faites un exercice pour commencer votre série.";
  if (s.atRisk) return `Votre série de ${s.current} jour${s.current > 1 ? "s" : ""} se poursuit dès aujourd'hui : une courte activité suffit.`;
  if (s.current === 0) return s.longest > 1 ? `Nouveau départ possible : votre record est de ${s.longest} jours.` : "Une nouvelle série commence dès votre prochaine activité.";
  if (s.current === 1) return "C'est parti : première journée de la série.";
  if (s.current >= s.longest) return `${s.current} jours d'affilée : c'est votre meilleure série.`;
  return `${s.current} jours d'affilée. Il en faut ${s.longest - s.current + 1} de plus pour battre votre record.`;
}
