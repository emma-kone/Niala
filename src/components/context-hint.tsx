"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Infobulles contextuelles. Tout élément portant data-hint en bénéficie :
//  - souris : la bulle suit le curseur, sans le remplacer, et reste dans l'écran ;
//  - clavier : elle s'affiche au focus, sous l'élément ;
//  - tactile : un appui long l'affiche, un simple appui garde son action normale.
// data-hint-action ajoute l'action proposée (« Modifier », « Ouvrir le cours »…).
// Le même texte est annoncé aux technologies d'assistance par une zone discrète.
// ─────────────────────────────────────────────────────────────────────────────

const OFFSET = 14;
const LONG_PRESS_MS = 450;

interface Hint {
  text: string;
  action: string | null;
  x: number;
  y: number;
}

const targetOf = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>("[data-hint]") : null);

export function ContextHintLayer() {
  const [hint, setHint] = useState<Hint | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let press: ReturnType<typeof setTimeout> | undefined;
    const show = (el: HTMLElement, x: number, y: number) => {
      current.current = el;
      setHint({ text: el.dataset.hint ?? "", action: el.dataset.hintAction ?? null, x, y });
    };
    const hide = () => {
      current.current = null;
      setHint(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = targetOf(e);
      if (el) show(el, e.clientX, e.clientY);
      else if (current.current) hide();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && current.current) setHint((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
    };
    const focus = (e: FocusEvent) => {
      const el = targetOf(e);
      if (!el || !(e.target instanceof Element) || !e.target.matches(":focus-visible")) return;
      const r = el.getBoundingClientRect();
      show(el, r.left + r.width / 2, r.bottom);
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        const el = targetOf(e);
        if (el) press = setTimeout(() => show(el, e.clientX, e.clientY - 40), LONG_PRESS_MS);
      } else hide();
    };
    const up = () => {
      clearTimeout(press);
      setTimeout(() => {
        if (current.current && !current.current.matches(":hover")) hide();
      }, 1800);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  // Position calculée après rendu pour rester dans l'écran et ne pas recouvrir le pointeur.
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el || !hint) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const right = hint.x + OFFSET + width > window.innerWidth - margin;
    const below = hint.y + OFFSET + height > window.innerHeight - margin;
    const x = Math.max(margin, right ? hint.x - OFFSET - width : hint.x + OFFSET);
    const y = Math.max(margin, below ? hint.y - OFFSET - height : hint.y + OFFSET);
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }, [hint]);

  return (
    <>
      {hint && (
        <div ref={bubble} aria-hidden className="pointer-events-none fixed z-[120] max-w-[280px] rounded-xl bg-[var(--tooltip)] px-3 py-1.5 text-xs text-[var(--tooltip-foreground)] shadow-lg ring-1 ring-white/15">
          <span className="block leading-snug">{hint.text}</span>
          {hint.action && <span className="mt-0.5 block font-semibold text-[var(--niala-accent)]">{hint.action}</span>}
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">{hint ? `${hint.text}${hint.action ? `. ${hint.action}` : ""}` : ""}</div>
    </>
  );
}
