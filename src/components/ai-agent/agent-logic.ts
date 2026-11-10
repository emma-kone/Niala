// Logique pure de l'agent IA flottant (sans DOM) : position, limites, placement du panneau, mémorisation.

export interface Pt { x: number; y: number }
export interface Size { w: number; h: number }
/** Position relative : 0 = bord gauche/haut, 1 = bord droit/bas de la zone où le bouton peut aller (indépendante de la taille de l'écran). */
export interface Frac { fx: number; fy: number }

export const AGENT_MARGIN = 12;
export const DRAG_THRESHOLD_PX = 5;
export const AGENT_STORAGE_KEY = "niala:ai-agent:position";
/** Position de départ : en bas à droite de la page. */
export const DEFAULT_FRAC: Frac = { fx: 1, fy: 1 };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

/** Maintient le bouton entièrement dans la fenêtre. */
export function clampPoint(p: Pt, view: Size, box: Size, margin = AGENT_MARGIN, bottomInset = 0): Pt {
  return { x: clamp(p.x, margin, view.w - box.w - margin), y: clamp(p.y, margin, view.h - box.h - margin - bottomInset) };
}

export function fracToPoint(f: Frac, view: Size, box: Size, margin = AGENT_MARGIN, bottomInset = 0): Pt {
  const minX = margin;
  const maxX = Math.max(minX, view.w - box.w - margin);
  const minY = margin;
  const maxY = Math.max(minY, view.h - box.h - margin - bottomInset);
  return { x: minX + clamp(f.fx, 0, 1) * (maxX - minX), y: minY + clamp(f.fy, 0, 1) * (maxY - minY) };
}

export function pointToFrac(p: Pt, view: Size, box: Size, margin = AGENT_MARGIN, bottomInset = 0): Frac {
  const maxX = Math.max(margin, view.w - box.w - margin);
  const maxY = Math.max(margin, view.h - box.h - margin - bottomInset);
  return { fx: maxX === margin ? 1 : clamp((p.x - margin) / (maxX - margin), 0, 1), fy: maxY === margin ? 1 : clamp((p.y - margin) / (maxY - margin), 0, 1) };
}

/** Taille du panneau de discussion selon la fenêtre. */
export function panelSize(view: Size): Size {
  return { w: Math.min(400, view.w - 2 * AGENT_MARGIN), h: Math.min(580, Math.max(320, view.h - 2 * AGENT_MARGIN - 56)) };
}

/**
 * Place le panneau contre le bouton : au-dessus si la place suffit, sinon dessous ; aligné sur le bord du bouton le plus proche
 * du bord de l'écran, puis ramené dans la fenêtre. Sur un écran étroit, il occupe toute la largeur.
 */
export function placePanel(fab: Pt, fabSize: Size, view: Size, panel: Size, gap = 10): Pt {
  const above = fab.y - panel.h - gap;
  const y = above >= AGENT_MARGIN ? above : Math.min(fab.y + fabSize.h + gap, view.h - panel.h - AGENT_MARGIN);
  const alignRight = fab.x + fabSize.w / 2 > view.w / 2;
  const x = alignRight ? fab.x + fabSize.w - panel.w : fab.x;
  return { x: clamp(x, AGENT_MARGIN, view.w - panel.w - AGENT_MARGIN), y: clamp(y, AGENT_MARGIN, view.h - panel.h - AGENT_MARGIN) };
}

export function parseFrac(raw: string | null): Frac | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Frac>;
    return typeof v.fx === "number" && typeof v.fy === "number" && Number.isFinite(v.fx) && Number.isFinite(v.fy) ? { fx: clamp(v.fx, 0, 1), fy: clamp(v.fy, 0, 1) } : null;
  } catch {
    return null;
  }
}

/** Distance parcourue depuis l'appui : en dessous du seuil, c'est un clic ; au-delà, un déplacement. */
export const isDrag = (from: Pt, to: Pt, threshold = DRAG_THRESHOLD_PX) => Math.hypot(to.x - from.x, to.y - from.y) >= threshold;
