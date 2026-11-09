"use client";

import Link from "next/link";
import { useEffect } from "react";
import { create } from "zustand";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Barre d'outils du bas : elle n'existe que lorsqu'un écran de travail déclare ses actions avec useModuleToolbar
// (cours ouvert, espace de code, espace SQL). Partout ailleurs, le panneau principal garde sa forme simple.

export interface ToolAction {
  label: string;
  icon: LucideIcon;
  color: string;
  href?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}

const useToolbarStore = create<{ actions: ToolAction[] | null }>(() => ({ actions: null }));

export const useToolbarVisible = () => useToolbarStore((s) => s.actions !== null);

/** Déclare les actions de l'écran courant ; null tant qu'elles ne sont pas disponibles. La barre disparaît avec l'écran. */
export function useModuleToolbar(actions: ToolAction[] | null) {
  useEffect(() => {
    useToolbarStore.setState({ actions });
  });
  useEffect(() => () => useToolbarStore.setState({ actions: null }), []);
}

/** Onglet de la maquette Figma (760 × 88), ancré au bas du panneau principal. */
const TAB_PATH = "M0 87.91C0 87.87.023 87.84.054 87.83 17.523 83.82 32.858 71.713 43.709 54.576 60.095 28.699 80.305 0 106.002 0L667.32 0C694.26 0 715.09 31.481 731.76 59.146 739.16 71.43 748.82 81.29 759.91 87.64 759.97 87.67 760 87.74 760 87.81 760 87.92 759.94 88 759.86 88L.065 88C.029 88 0 87.96 0 87.91Z";

const BUTTON = "group flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-sm font-medium text-on-pastel ring-1 ring-black/10 transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0";
/** Le libellé reste dans le DOM : il est lu par les lecteurs d'écran même replié. */
const LABEL = "max-w-0 overflow-hidden whitespace-nowrap transition-[max-width,margin] duration-200 group-hover:ml-1.5 group-hover:max-w-28 group-focus-visible:ml-1.5 group-focus-visible:max-w-28";

export function FloatingToolbar() {
  const actions = useToolbarStore((s) => s.actions);
  if (!actions) return null;
  return (
    <nav aria-label="Actions de l'espace de travail" className="absolute bottom-0 left-1/2 z-40 h-[65px] w-[min(560px,calc(100%-16px))] -translate-x-1/2">
      <svg aria-hidden viewBox="0 0 760 88" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path d={TAB_PATH} fill="var(--niala-accent)" />
      </svg>
      <ul className="relative flex h-full items-center justify-center gap-1.5 pt-1 sm:gap-2.5">
        {actions.map((a) => {
          const Icon = a.icon;
          const style = { background: a.color };
          const cls = cn(BUTTON, a.active && "ring-2 ring-[var(--on-pastel)]");
          const body = (
            <>
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className={cn(LABEL, a.active && "ml-1.5 max-w-28")}>{a.label}</span>
            </>
          );
          return (
            <li key={a.label}>
              {a.href ? (
                <Link href={a.href} className={cls} style={style}>{body}</Link>
              ) : (
                <button type="button" onClick={a.onClick} disabled={a.disabled} aria-pressed={a.active} className={cls} style={style}>{body}</button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
