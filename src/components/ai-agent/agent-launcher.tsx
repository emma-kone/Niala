"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GripHorizontal, Maximize2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_MARGIN, AGENT_STORAGE_KEY, DEFAULT_FRAC, clampPoint, fracToPoint, isDrag, panelSize, parseFrac, placePanel, pointToFrac, type Pt, type Size } from "@/components/ai-agent/agent-logic";
import { routes } from "@/config/routes";

// Agent IA flottant : un bouton présent sur toute la plateforme étudiante, qu'on déplace à la souris (ou au doigt, ou aux flèches
// du clavier). Un clic ouvre une discussion compacte avec l'assistant, sans quitter la page ; sa position est mémorisée.
// Le panneau n'est chargé qu'à la première ouverture : le bouton seul ne pèse rien sur l'espace étudiant.

const ChatPanel = dynamic(() => import("@/features/chat/chat-panel"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted-foreground">Chargement de l&apos;assistant…</p> });

const FAB: Size = { w: 56, h: 56 };
const HEADER_H = 44;
const ARROW_STEP = 16;

function readFrac() {
  try {
    return parseFrac(localStorage.getItem(AGENT_STORAGE_KEY));
  } catch {
    return null;
  }
}
function writeFrac(value: ReturnType<typeof pointToFrac>) {
  try {
    localStorage.setItem(AGENT_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* stockage indisponible : la position ne sera pas mémorisée */
  }
}

export function AgentLauncher() {
  const pathname = usePathname();
  const [view, setView] = useState<Size | null>(null);
  const [pos, setPos] = useState<Pt | null>(null);
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ start: Pt; origin: Pt; moved: boolean; pointer: number; fromPanel: boolean } | null>(null);
  const bottomInset = useRef(0);

  // Mesure de la fenêtre et position initiale (mémorisée ou en bas à droite). Hors du corps de l'effet pour rester asynchrone.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const v = { w: window.innerWidth, h: window.innerHeight };
      setView(v);
      setPos((current) => (current ? clampPoint(current, v, FAB, AGENT_MARGIN, bottomInset.current) : fracToPoint(readFrac() ?? DEFAULT_FRAC, v, FAB, AGENT_MARGIN, bottomInset.current)));
    };
    frame = requestAnimationFrame(measure);
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const persist = useCallback((p: Pt, v: Size) => writeFrac(pointToFrac(p, v, FAB, AGENT_MARGIN, bottomInset.current)), []);

  const onPointerDown = (e: React.PointerEvent, fromPanel: boolean) => {
    if (!pos || !view || (e.pointerType === "mouse" && e.button !== 0)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: pos, moved: false, pointer: e.pointerId, fromPanel };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !view || d.pointer !== e.pointerId) return;
    const here = { x: e.clientX, y: e.clientY };
    if (!d.moved && !isDrag(d.start, here)) return;
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    setPos(clampPoint({ x: d.origin.x + here.x - d.start.x, y: d.origin.y + here.y - d.start.y }, view, FAB, AGENT_MARGIN, bottomInset.current));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (d.moved) {
      if (pos && view) persist(pos, view);
    } else if (!d.fromPanel) {
      setOpen((o) => !o);
      setEverOpened(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const delta: Record<string, Pt> = { ArrowLeft: { x: -ARROW_STEP, y: 0 }, ArrowRight: { x: ARROW_STEP, y: 0 }, ArrowUp: { x: 0, y: -ARROW_STEP }, ArrowDown: { x: 0, y: ARROW_STEP } };
    const d = delta[e.key];
    if (!d || !pos || !view) return;
    e.preventDefault();
    const next = clampPoint({ x: pos.x + d.x, y: pos.y + d.y }, view, FAB, AGENT_MARGIN, bottomInset.current);
    setPos(next);
    persist(next, view);
  };

  // L'assistant a déjà sa propre page : le bouton n'y est pas nécessaire.
  if (pathname.startsWith(routes.assistant) || !pos || !view) return null;

  const panel = panelSize(view);
  const where = placePanel(pos, FAB, view, panel);

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Assistant IA"
          className={cn("fixed z-[60] flex flex-col overflow-hidden rounded-3xl border bg-background text-foreground shadow-2xl", !dragging && "motion-safe:transition-[top,left] motion-safe:duration-150")}
          style={{ top: where.y, left: where.x, width: panel.w, height: panel.h }}
        >
          <header
            className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b bg-card px-3 active:cursor-grabbing"
            style={{ height: HEADER_H }}
            onPointerDown={(e) => !(e.target as HTMLElement).closest("a,button") && onPointerDown(e, true)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <GripHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h2 className="flex-1 truncate text-sm font-semibold">Assistant IA</h2>
            <Link href={routes.assistant} onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Ouvrir l'assistant en pleine page" title="Pleine page"><Maximize2 className="h-4 w-4" aria-hidden /></Link>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fermer l'assistant"><X className="h-4 w-4" aria-hidden /></button>
          </header>
          <div className="min-h-0 flex-1">{everOpened || open ? <ChatPanel scope="GLOBAL" variant="panel" /> : null}</div>
        </section>
      )}
      <button
        type="button"
        data-tour="ai-agent"
        aria-label={open ? "Fermer l'assistant IA" : "Ouvrir l'assistant IA"}
        aria-expanded={open}
        aria-describedby="ai-agent-hint"
        title="Assistant IA — glissez pour déplacer"
        onPointerDown={(e) => onPointerDown(e, false)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          // Le clic souris est géré par onPointerUp ; ce gestionnaire ne sert qu'au clavier (Entrée / Espace : detail = 0).
          if (e.detail === 0) {
            setOpen((o) => !o);
            setEverOpened(true);
          }
        }}
        className={cn("fixed z-[60] flex touch-none select-none items-center justify-center rounded-full bg-[var(--niala-accent)] text-[var(--niala-accent-foreground)] shadow-lg ring-2 ring-white/20 outline-none focus-visible:ring-4 focus-visible:ring-ring/60", dragging ? "cursor-grabbing scale-105" : "cursor-grab motion-safe:transition-transform hover:scale-105")}
        style={{ top: pos.y, left: pos.x, width: FAB.w, height: FAB.h }}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <Sparkles className="h-6 w-6" aria-hidden />}
      </button>
      <span id="ai-agent-hint" className="sr-only">Glissez le bouton avec la souris ou utilisez les flèches du clavier pour le déplacer.</span>
    </>
  );
}
