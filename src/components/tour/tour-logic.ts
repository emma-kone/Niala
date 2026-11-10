// Logique pure de la visite guidée (sans DOM) : testable, et partagée par les deux plateformes.

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** Sélecteur CSS de l'élément à mettre en lumière. Absent : carte centrée. Élément introuvable ou invisible : étape ignorée. */
  selector?: string;
  placement?: "auto" | "top" | "bottom" | "left" | "right";
}

export interface Box { top: number; left: number; width: number; height: number }
export interface Size { w: number; h: number }
export type Side = "top" | "bottom" | "left" | "right" | "center";

export const TOUR_EVENT = "niala:start-tour";

/** Clé de mémorisation : par visite, par compte et par version (une nouvelle version relance la visite). */
export const storageKey = (tourId: string, userKey: string, version: number) => `niala:tour:${tourId}:v${version}:${userKey}`;

/** Garde les étapes dont la cible est affichée. Sur petit écran (menu masqué), il reste l'accueil et la conclusion. */
export function keepVisibleSteps(steps: TourStep[], isVisible: (selector: string) => boolean): TourStep[] {
  return steps.filter((s) => !s.selector || isVisible(s.selector));
}

/**
 * Place la carte à côté de l'élément ciblé, dans la fenêtre : côté préféré si la place suffit, sinon le côté le plus dégagé.
 * Sans cible, la carte est centrée.
 */
export function placePopover(target: Box | null, viewport: Size, pop: Size, preferred: TourStep["placement"] = "auto", gap = 14, margin = 12): { top: number; left: number; side: Side } {
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
  if (!target) return { top: Math.max(margin, (viewport.h - pop.h) / 2), left: Math.max(margin, (viewport.w - pop.w) / 2), side: "center" };

  const room = {
    bottom: viewport.h - (target.top + target.height) - margin,
    top: target.top - margin,
    right: viewport.w - (target.left + target.width) - margin,
    left: target.left - margin,
  };
  const fits = (s: "top" | "bottom" | "left" | "right") => (s === "top" || s === "bottom" ? room[s] >= pop.h + gap : room[s] >= pop.w + gap);
  const order: ("bottom" | "right" | "left" | "top")[] = ["bottom", "right", "left", "top"];
  const side =
    preferred && preferred !== "auto" && fits(preferred)
      ? preferred
      : (order.find(fits) ?? (Object.entries(room).sort((a, b) => b[1] - a[1])[0][0] as "top" | "bottom" | "left" | "right"));

  const centerX = target.left + target.width / 2 - pop.w / 2;
  const centerY = target.top + target.height / 2 - pop.h / 2;
  const pos =
    side === "bottom" ? { top: target.top + target.height + gap, left: centerX }
    : side === "top" ? { top: target.top - pop.h - gap, left: centerX }
    : side === "right" ? { top: centerY, left: target.left + target.width + gap }
    : { top: centerY, left: target.left - pop.w - gap };
  return { top: clamp(pos.top, margin, viewport.h - pop.h - margin), left: clamp(pos.left, margin, viewport.w - pop.w - margin), side };
}
