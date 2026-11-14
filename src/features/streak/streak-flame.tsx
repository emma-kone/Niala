"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDay } from "@/features/agenda/types";
import type { StreakData } from "@/features/streak/use-streak";

// Série de jours en haut à droite de la grande forme en L. Animation reprise de la référence choisie (minuteur « streak ») :
// la flamme grise s'écrase, s'étire et s'allume en orange, des étincelles jaillissent, le chiffre passe au suivant et le
// jour de la semaine se coche. Elle ne se joue qu'une fois par nouvelle valeur de la série ; sinon la flamme ondule doucement.
// Animations définies dans globals.css (préfixe niala-streak) et coupées si l'étudiant a demandé moins de mouvement.

const SEEN_KEY = "niala-streak-seen";

function readSeen() {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}
function writeSeen(v: string) {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    /* stockage indisponible : l'animation pourra se rejouer au prochain chargement */
  }
}

/** Flamme vectorielle : allumée (orange, cœur jaune) ou éteinte (grise). `calm` : allumée mais immobile (journée pas encore faite). */
export function FlameMark({ lit, play, calm, className }: { lit: boolean; play?: boolean; calm?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 84" aria-hidden className={cn("overflow-visible", className)} data-lit={lit} data-play={play || undefined} data-calm={calm || undefined}>
      <ellipse className="niala-streak-glow" cx="32" cy="79" rx="15" ry="3.6" />
      <g className="niala-streak-flame">
        <path className="niala-streak-outer" d="M32 4C38.5 16 52 25 52 47c0 16-9 28-20 28S12 63 12 47c0-12 5.5-18.5 10-24.5 1 8 4 11.5 7.5 12.5C27.5 22.5 28 12.5 32 4Z" />
        <path className="niala-streak-core" d="M32 41c5 6.5 10 10.5 10 17.5C42 65.5 37.5 71 32 71s-10-5.5-10-12.5C22 51.5 27 47.5 32 41Z" />
      </g>
      {play && (
        <g className="niala-streak-sparks">
          {[[-26, -20], [24, -24], [-30, 6], [30, 2], [-14, -34], [12, -36]].map(([x, y], i) => (
            <rect key={i} x="30" y="38" width="4" height="4" rx="1" style={{ "--sx": `${x}px`, "--sy": `${y}px`, animationDelay: `${0.62 + i * 0.03}s` } as React.CSSProperties} />
          ))}
        </g>
      )}
    </svg>
  );
}

/**
 * Carte de la série : flamme animée, nombre de jours, libellé et semaine en cours. Prévue pour le coin haut droit de la grande
 * forme en L : ligne compacte dans le flux jusqu'à 1280 px, carte complète posée dans le coin au-delà.
 */
export function StreakHero({ streak, className }: { streak: StreakData; className?: string }) {
  // Journée faite : c'est elle qui déclenche l'animation d'allumage. La carte garde ses couleurs dans tous les cas (même à 0 jour) ;
  // tant que la journée n'est pas faite, la flamme reste immobile et le jour en cours est cerclé dans la semaine.
  const lit = streak.doneToday && streak.current > 0;
  const signature = `${streak.lastDay}:${streak.current}`;
  const [play, setPlay] = useState(false);

  // Nouvelle valeur de la série (première activité du jour) : l'animation se joue une fois. Elle n'est notée comme vue qu'au
  // moment où elle démarre : un effet annulé avant (double passage de React en développement, page quittée) la laisse à jouer.
  useEffect(() => {
    if (!lit || readSeen() === signature) return;
    let stop = 0;
    const start = window.setTimeout(() => {
      writeSeen(signature);
      setPlay(true);
      stop = window.setTimeout(() => setPlay(false), 2600);
    }, 60);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
      setPlay(false);
    };
  }, [lit, signature]);

  const days = (n: number) => `${n} jour${n > 1 ? "s" : ""}`;
  const previous = Math.max(0, streak.current - 1);
  const today = streak.week[streak.week.length - 1]?.date;

  return (
    <div
      role="group"
      aria-label={`Série de jours : ${days(streak.current)}, ${streak.doneToday ? "fait aujourd'hui" : "à faire aujourd'hui"}. Record : ${days(streak.longest)}. ${streak.message}`}
      data-testid="streak"
      data-play={play || undefined}
      className={cn("niala-streak flex shrink-0 items-center gap-3 rounded-[26px] bg-[color-mix(in_srgb,var(--dash-panel-foreground)_7%,var(--dash-panel))] px-3.5 py-2.5 text-dash-panel-foreground shadow-[0_12px_30px_-18px_rgb(0_0_0/0.35)] xl:absolute xl:-right-4 xl:-top-1 xl:flex-col xl:gap-1 xl:rounded-[32px] xl:px-5 xl:py-4", className)}
      title={streak.message}
    >
      <FlameMark lit play={play} calm={!lit} className="h-11 w-9 xl:h-[clamp(3rem,8vh,4.5rem)] xl:w-auto" />
      <div className="min-w-0 xl:text-center">
        <p className={cn("tnum relative h-[1.1em] overflow-hidden text-3xl font-extrabold leading-none xl:text-[clamp(1.9rem,5vh,2.6rem)] text-[var(--streak-orange)]")}>
          {play ? (
            <>
              <span className="niala-streak-old absolute inset-x-0 text-dash-panel-foreground/35">{previous}</span>
              <span className="niala-streak-new block">{streak.current}</span>
            </>
          ) : (
            streak.current
          )}
        </p>
        <p className="mt-0.5 text-xs font-semibold text-[var(--streak-orange)]">{streak.current > 1 ? "jours de série" : "jour de série"}</p>
      </div>
      <ol aria-label="Sept derniers jours" className="hidden items-center gap-1 sm:flex lg:hidden xl:mt-1.5 xl:flex">
        {streak.week.map((d) => {
          const isToday = d.date === today;
          return (
            <li key={d.date} className="flex flex-col items-center gap-0.5" aria-label={`${formatDay(d.date, { weekday: "long", day: "numeric", month: "long" })} : ${d.active ? "actif" : isToday ? "à faire" : "non actif"}`}>
              <span aria-hidden className={cn("text-[9px] font-medium capitalize", isToday ? "text-[var(--streak-orange)]" : "text-dash-panel-foreground/60")}>{formatDay(d.date, { weekday: "narrow" })}</span>
              <span
                aria-hidden
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full",
                  d.active ? "bg-[var(--streak-orange)] text-white" : "bg-dash-panel-foreground/15",
                  isToday && !d.active && "ring-2 ring-[var(--streak-orange)]/50",
                  isToday && d.active && play && "niala-streak-day",
                )}
              >
                {d.active && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="hidden min-w-0 text-center xl:block">
        <p className="tnum text-[11px] font-medium text-dash-panel-foreground/60">Record : {days(streak.longest)}</p>
        <p className="mt-0.5 line-clamp-2 max-w-[13rem] text-[11px] leading-snug text-dash-panel-foreground/60">{streak.message}</p>
      </div>
    </div>
  );
}
