"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GripHorizontal, Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_MARGIN, AGENT_STORAGE_KEY, DEFAULT_FRAC, clampPoint, fracToPoint, isDrag, panelSize, parseFrac, placePanel, pointToFrac, type Pt, type Size } from "@/components/ai-agent/agent-logic";
import { routes } from "@/config/routes";

// Agent IA flottant : Clay, le robot du portfolio, présent sur toute la plateforme étudiante. On le déplace à la souris (ou au
// doigt, ou aux flèches du clavier) ; un clic sur lui le fait sauter et ouvre une discussion compacte avec l'assistant, sans
// quitter la page ; sa position est mémorisée. Comme dans le portfolio, il suit le curseur du regard, salue, cligne des yeux,
// saute de joie à chaque clic sur un bouton ou un lien de la page, et commente brièvement la page où l'on arrive.
// Le robot (shader WebGL) et le panneau sont chargés à part : ils n'alourdissent pas le premier affichage.

const ChatPanel = dynamic(() => import("@/features/chat/chat-panel"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted-foreground">Chargement de l&apos;assistant…</p> });

const ClayRobot = dynamic(() => import("@/components/ai-agent/clay-robot"), { ssr: false });

const FAB: Size = { w: 84, h: 84 };

/** Ce que Clay dit en arrivant sur une page (une fois par page et par visite). Le premier préfixe qui correspond l'emporte. */
const LINES: [string, string][] = [
  ["/matieres", "Ouvrez un cours : je peux vous l'expliquer ou le résumer."],
  ["/exercices", "Bloqué sur un exercice ? Cliquez sur moi."],
  ["/agenda", "Besoin d'aide pour organiser votre semaine ?"],
  ["/code", "Une erreur dans votre code ? On regarde ensemble."],
  ["/sql", "Une requête qui coince ? Demandez-moi."],
  ["/notes", "Je peux transformer vos notes en fiche de révision."],
  ["/progression", "Je peux vous aider sur vos notions fragiles."],
  ["/", "Bonjour, moi c'est Clay ! Cliquez sur moi pour poser une question."],
];
const lineFor = (path: string) => LINES.find(([p]) => (p === "/" ? path === "/" : path.startsWith(p)))?.[1] ?? null;

/** Ses réactions quand on clique sur un bouton ou un lien (il saute). La bulle est espacée pour ne pas gêner le travail. */
const CHEERS = ["Hop !", "Bien vu !", "C'est parti !", "Bonne idée !", "Et hop !", "Youpi !"];
const CHEER_GAP_MS = 8_000;
const GREETED_KEY = "niala-clay-greeted";

/** Vrai si Clay a déjà commenté cette page pendant la visite ; sinon, la note comme commentée. */
function greetedOn(path: string) {
  try {
    const seen = JSON.parse(sessionStorage.getItem(GREETED_KEY) ?? "[]") as string[];
    if (seen.includes(path)) return true;
    sessionStorage.setItem(GREETED_KEY, JSON.stringify([...seen, path].slice(-30)));
  } catch {
    /* stockage indisponible : Clay peut se répéter */
  }
  return false;
}
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
  const robot = useRef<HTMLSpanElement>(null);
  const [bubble, setBubble] = useState<string | null>(null);
  const bubbleTimer = useRef(0);
  const lastCheer = useRef(0);
  const cheers = useRef(0);

  const say = useCallback((text: string, ms: number) => {
    setBubble(text);
    window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }, []);
  useEffect(() => () => window.clearTimeout(bubbleTimer.current), []);

  // Il commente la page où l'on arrive, une fois par page et par visite (jamais pendant une discussion).
  useEffect(() => {
    if (open) return;
    const line = lineFor(pathname);
    if (!line) return;
    const t = window.setTimeout(() => {
      if (!greetedOn(pathname)) say(line, 5000);
    }, 1600);
    return () => window.clearTimeout(t);
  }, [pathname, open, say]);

  // Un clic sur un bouton ou un lien de la page : Clay saute de joie (et le dit, de temps en temps).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target?.closest("a, button, [role='button']") || target.closest("[data-clay]")) return;
      // Le robot saute quand on appuie sur lui : on lui transmet l'appui, sans le faire remonter dans la page.
      robot.current?.querySelector<HTMLElement>("[role='img']")?.dispatchEvent(new PointerEvent("pointerdown", { clientX: e.clientX, clientY: e.clientY, pointerType: "mouse", bubbles: false }));
      if (open || Date.now() - lastCheer.current < CHEER_GAP_MS) return;
      lastCheer.current = Date.now();
      say(CHEERS[cheers.current++ % CHEERS.length], 1500);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open, say]);

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
          aria-label="Clay, l'assistant IA"
          data-clay
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
            <h2 className="flex-1 truncate text-sm font-semibold">Clay · Assistant IA</h2>
            <Link href={routes.assistant} onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Ouvrir l'assistant en pleine page" title="Pleine page"><Maximize2 className="h-4 w-4" aria-hidden /></Link>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fermer l'assistant"><X className="h-4 w-4" aria-hidden /></button>
          </header>
          <div className="min-h-0 flex-1">{everOpened || open ? <ChatPanel scope="GLOBAL" variant="panel" /> : null}</div>
        </section>
      )}
      {bubble && !open && (
        <p
          role="status"
          data-clay
          className="niala-clay-bubble pointer-events-none fixed z-[61] w-max max-w-[min(15rem,calc(100vw-2rem))] rounded-2xl rounded-br-sm bg-foreground px-3.5 py-2 text-center text-sm leading-snug text-background shadow-[0_10px_30px_-10px_rgb(0_0_0/0.5)]"
          style={{ left: Math.min(view.w - 130, Math.max(130, pos.x + FAB.w / 2)), top: Math.max(pos.y, 64) - 4, transform: "translate(-50%, -100%)" }}
        >
          {bubble}
        </p>
      )}
      <button
        type="button"
        data-tour="ai-agent"
        data-clay
        aria-label={open ? "Fermer l'assistant IA (Clay)" : "Ouvrir l'assistant IA (Clay)"}
        aria-expanded={open}
        aria-describedby="ai-agent-hint"
        title="Clay, l'assistant IA — cliquez pour discuter, glissez pour déplacer"
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
        className={cn("fixed z-[60] touch-none select-none rounded-[28px] outline-none focus-visible:ring-4 focus-visible:ring-ring/60", dragging ? "cursor-grabbing" : "cursor-grab")}
        style={{ top: pos.y, left: pos.x, width: FAB.w, height: FAB.h }}
      >
        {/* Clay : posé sans décor, il regarde le curseur, salue et saute quand on appuie sur lui. */}
        <span ref={robot} aria-hidden className="absolute inset-0 block">
          <ClayRobot transparent animate delay={0.5} walk={false} scale={150} placement={{ x: 0, y: 14, angle: 0, tilt: 0 }} background={{ shadow: "#1f1930", shadowDepth: 45 }} style={{ aspectRatio: "auto", cursor: "inherit", touchAction: "none" }} />
        </span>
        {open && <span aria-hidden className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background shadow"><X className="h-3.5 w-3.5" /></span>}
      </button>
      <span id="ai-agent-hint" className="sr-only">Glissez le bouton avec la souris ou utilisez les flèches du clavier pour le déplacer.</span>
    </>
  );
}
