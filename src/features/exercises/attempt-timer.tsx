"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Timer, TimerReset, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Chronométrage d'une tentative, au choix de l'étudiant :
//  - « Chrono » : compte le temps passé, pour savoir en combien de temps l'exercice a été traité ;
//  - « Minuteur » : un temps imparti décompté ; à zéro, l'étudiant est averti (rien n'est coupé sans son accord).
// L'état est conservé pour la tentative (rechargement, retour plus tard) ; le temps en pause ne compte pas.

export type TimerMode = "off" | "stopwatch" | "countdown";

interface Stored {
  mode: TimerMode;
  /** Temps imparti (minuteur), en secondes. */
  limitSec: number;
  /** Temps déjà écoulé avant la dernière reprise, en secondes. */
  base: number;
  /** Instant de la dernière reprise ; null en pause. */
  since: number | null;
  /** Le temps imparti est déjà annoncé comme écoulé. */
  expired: boolean;
}

const OFF: Stored = { mode: "off", limitSec: 0, base: 0, since: null, expired: false };
const keyOf = (attemptId: string) => `niala-attempt-timer:${attemptId}`;
const PRESETS_MIN = [5, 10, 15, 20, 30, 45, 60];

function read(attemptId: string): Stored {
  try {
    const raw = localStorage.getItem(keyOf(attemptId));
    if (!raw) return OFF;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (v.mode !== "stopwatch" && v.mode !== "countdown") return OFF;
    return { mode: v.mode, limitSec: Math.max(0, Number(v.limitSec) || 0), base: Math.max(0, Number(v.base) || 0), since: typeof v.since === "number" ? v.since : null, expired: v.expired === true };
  } catch {
    return OFF;
  }
}

export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** « 12 min 04 s » : durée lisible pour le bilan. */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(sec).padStart(2, "0")} s`;
  return `${sec} s`;
}

export function useAttemptTimer(attemptId: string, active: boolean, onExpire: () => void) {
  const [stored, setStored] = useState<Stored>(OFF);
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  const expireRef = useRef(onExpire);
  useEffect(() => {
    expireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    setStored(read(attemptId));
    loaded.current = true;
  }, [attemptId]);

  const save = useCallback(
    (next: Stored) => {
      setStored(next);
      try {
        if (next.mode === "off") localStorage.removeItem(keyOf(attemptId));
        else localStorage.setItem(keyOf(attemptId), JSON.stringify(next));
      } catch {
        /* chronomètre non mémorisable : il continue pour cette page */
      }
    },
    [attemptId]
  );

  const running = stored.mode !== "off" && stored.since !== null && active;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const elapsedSec = stored.base + (stored.since !== null && active ? Math.max(0, (now - stored.since) / 1000) : 0);
  const remainingSec = stored.mode === "countdown" ? stored.limitSec - elapsedSec : null;

  // Temps imparti écoulé : une seule annonce par tentative.
  useEffect(() => {
    if (!loaded.current || stored.mode !== "countdown" || stored.expired || remainingSec === null || remainingSec > 0 || !active) return;
    save({ ...stored, expired: true });
    expireRef.current();
  }, [remainingSec, stored, active, save]);

  const controls = useMemo(
    () => ({
      start: (mode: "stopwatch" | "countdown", limitMinutes = 0) => save({ mode, limitSec: mode === "countdown" ? Math.max(1, Math.round(limitMinutes * 60)) : 0, base: 0, since: Date.now(), expired: false }),
      pause: () => save({ ...stored, base: elapsedSec, since: null }),
      resume: () => save({ ...stored, since: Date.now() }),
      stop: () => save(OFF),
      /** Fige le temps (fin de l'exercice) et le renvoie en secondes ; null si aucun chronomètre n'est actif. */
      freeze: (): number | null => {
        if (stored.mode === "off") return null;
        const total = Math.max(1, Math.round(elapsedSec));
        save({ ...stored, base: total, since: null });
        return total;
      },
    }),
    [save, stored, elapsedSec]
  );

  return { mode: stored.mode, limitSec: stored.limitSec, paused: stored.mode !== "off" && stored.since === null, elapsedSec, remainingSec, ...controls };
}

type TimerApi = ReturnType<typeof useAttemptTimer>;

/** Barre de chronométrage : choix du mode quand rien ne tourne, affichage et pause ensuite. */
export function AttemptTimerBar({ timer }: { timer: TimerApi }) {
  const [choosing, setChoosing] = useState(false);
  const [minutes, setMinutes] = useState("15");

  if (timer.mode === "off") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Chronométrage">
        {!choosing ? (
          <>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => timer.start("stopwatch")} title="Compte le temps passé : vous le verrez à la fin">
              <Timer className="h-4 w-4" aria-hidden /> Chrono
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setChoosing(true)} title="Fixez un temps pour traiter l'exercice">
              <TimerReset className="h-4 w-4" aria-hidden /> Minuteur
            </Button>
          </>
        ) : (
          <form
            className="flex flex-wrap items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const m = Number(minutes);
              if (Number.isFinite(m) && m >= 1 && m <= 600) {
                timer.start("countdown", m);
                setChoosing(false);
              }
            }}
          >
            <span className="text-xs text-muted-foreground">Temps imparti :</span>
            {PRESETS_MIN.map((m) => (
              <button key={m} type="button" aria-pressed={Number(minutes) === m} onClick={() => setMinutes(String(m))} className={cn("rounded-md border px-2 py-1 text-xs", Number(minutes) === m ? "border-foreground bg-muted font-semibold" : "hover:bg-muted")}>
                {m} min
              </button>
            ))}
            <input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} aria-label="Temps imparti en minutes" className="h-7 w-16 rounded-md border bg-background px-2 text-xs" />
            <Button type="submit" size="sm" className="h-7 gap-1.5"><Play className="h-3.5 w-3.5" aria-hidden /> Démarrer</Button>
            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setChoosing(false)}>Annuler</Button>
          </form>
        )}
      </div>
    );
  }

  const over = timer.remainingSec !== null && timer.remainingSec < 0;
  const low = timer.remainingSec !== null && timer.remainingSec > 0 && timer.remainingSec <= Math.min(60, timer.limitSec * 0.1);
  return (
    <div className="flex items-center gap-2" role="timer" aria-label={timer.mode === "countdown" ? "Temps restant" : "Temps écoulé"}>
      <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-sm tabular-nums", over && "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300", low && "border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300")}>
        <Timer className="h-4 w-4" aria-hidden />
        {timer.mode === "countdown" ? (over ? `+${formatClock(-(timer.remainingSec ?? 0))}` : formatClock(timer.remainingSec ?? 0)) : formatClock(timer.elapsedSec)}
        {timer.mode === "countdown" && <span className="font-sans text-[11px] text-muted-foreground">/ {formatClock(timer.limitSec)}</span>}
      </span>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={timer.paused ? timer.resume : timer.pause} aria-label={timer.paused ? "Reprendre le chronomètre" : "Mettre le chronomètre en pause"}>
        {timer.paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={timer.stop} aria-label="Arrêter et masquer le chronomètre">
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
