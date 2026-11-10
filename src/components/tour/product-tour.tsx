"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { TOUR_EVENT, keepVisibleSteps, placePopover, storageKey, type Box, type TourStep } from "@/components/tour/tour-logic";

// Visite guidée (Product Tour) : met en lumière les éléments de l'interface, un par un.
//  - démarre toute seule à la première visite d'un compte, une fois par version de visite ;
//  - se relance à la demande (startTour) ; Échap ou « Passer la visite » l'arrête et la marque comme vue ;
//  - clavier : ← → pour naviguer, Échap pour quitter ; la carte reprend le focus à chaque étape ;
//  - s'adapte aux petits écrans : les étapes dont la cible est masquée sont ignorées.

export function startTour(tourId: string) {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { tourId } }));
}

function readDone(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeDone(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* stockage indisponible : la visite pourra se reproposer */
  }
}

const isVisible = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  return !!el && el.getClientRects().length > 0 && el.getBoundingClientRect().width > 0;
};

interface Props {
  tourId: string;
  version: number;
  userKey: string;
  steps: TourStep[];
  autoStart?: boolean;
}

export function ProductTour({ tourId, version, userKey, steps, autoStart = true }: Props) {
  const key = storageKey(tourId, userKey, version);
  const [active, setActive] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 1024, h: 768 });
  const [pop, setPop] = useState({ w: 340, h: 200 });
  const nextRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const begin = useCallback(() => {
    const list = keepVisibleSteps(steps, isVisible);
    if (!list.length) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
    setActive(list);
  }, [steps]);

  const close = useCallback(() => {
    writeDone(key);
    setActive(null);
    setBox(null);
    returnFocus.current?.focus?.();
  }, [key]);

  // Première visite : démarrage différé, le temps que l'interface soit en place.
  useEffect(() => {
    if (!autoStart || readDone(key)) return;
    const t = setTimeout(begin, 1200);
    return () => clearTimeout(t);
  }, [autoStart, key, begin]);

  // Relance à la demande.
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<{ tourId: string }>).detail?.tourId === tourId) begin();
    };
    window.addEventListener(TOUR_EVENT, on);
    return () => window.removeEventListener(TOUR_EVENT, on);
  }, [tourId, begin]);

  const step = active?.[index];

  // Mesure de la cible (et de la fenêtre) ; recalculée au défilement et au redimensionnement.
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    const measure = () => {
      const el = step.selector ? document.querySelector<HTMLElement>(step.selector) : null;
      const r = el?.getBoundingClientRect();
      setBox(r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
      setView({ w: window.innerWidth, h: window.innerHeight });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const el = step.selector ? document.querySelector<HTMLElement>(step.selector) : null;
    el?.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
    schedule();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [step]);

  // Clavier et focus.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setIndex((i) => (i < active.length - 1 ? i + 1 : i));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, close]);
  useEffect(() => {
    if (step) nextRef.current?.focus();
  }, [step]);

  if (!active || !step) return null;
  const last = index === active.length - 1;
  const place = placePopover(box, view, pop, step.placement);
  const pad = 6;

  return (
    <div className="fixed inset-0 z-[200]" data-product-tour>
      {/* Le fond bloque les clics sur l'interface pendant la visite. */}
      <div className="absolute inset-0" aria-hidden onClick={(e) => e.stopPropagation()} />
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-xl ring-2 ring-[var(--niala-accent)] motion-safe:transition-all motion-safe:duration-200"
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2, boxShadow: "0 0 0 9999px rgba(10, 6, 20, 0.62)" }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[rgba(10,6,20,0.62)]" />
      )}
      <div
        ref={(node) => {
          if (node && (Math.abs(node.offsetWidth - pop.w) > 1 || Math.abs(node.offsetHeight - pop.h) > 1)) setPop({ w: node.offsetWidth, h: node.offsetHeight });
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={cn("absolute w-[min(340px,calc(100vw-24px))] rounded-2xl border bg-popover p-4 text-popover-foreground shadow-2xl motion-safe:transition-[top,left] motion-safe:duration-200")}
        style={{ top: place.top, left: place.left }}
      >
        <button type="button" onClick={close} aria-label="Fermer la visite guidée" className="absolute right-2.5 top-2.5 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" aria-hidden />
        </button>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--niala-accent)]">Visite guidée · {index + 1} / {active.length}</p>
        <h2 id="tour-title" className="mt-1 pr-6 text-base font-semibold leading-snug">{step.title}</h2>
        <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-3 flex gap-1" aria-hidden>
          {active.map((s, i) => <span key={s.id} className={cn("h-1 flex-1 rounded-full", i <= index ? "bg-[var(--niala-accent)]" : "bg-muted")} />)}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={close} className="text-xs text-muted-foreground underline-offset-2 hover:underline">{last ? "Fermer" : "Passer la visite"}</button>
          <div className="flex gap-2">
            {index > 0 && (
              <button type="button" onClick={() => setIndex(index - 1)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-sm hover:bg-muted"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Précédent</button>
            )}
            <button ref={nextRef} type="button" onClick={() => (last ? close() : setIndex(index + 1))} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
              {last ? "Terminer" : "Suivant"}{!last && <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
