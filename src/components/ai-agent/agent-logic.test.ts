import { describe, expect, it } from "vitest";
import { AGENT_MARGIN, DEFAULT_FRAC, clampPoint, fracToPoint, isDrag, panelSize, parseFrac, placePanel, pointToFrac } from "@/components/ai-agent/agent-logic";

const view = { w: 1280, h: 800 };
const fab = { w: 56, h: 56 };

describe("position du bouton IA", () => {
  it("démarre en bas à droite de la page", () => {
    expect(fracToPoint(DEFAULT_FRAC, view, fab)).toEqual({ x: 1280 - 56 - AGENT_MARGIN, y: 800 - 56 - AGENT_MARGIN });
  });

  it("reste entièrement dans la fenêtre, où que l'on le lâche", () => {
    for (const p of [{ x: -500, y: -500 }, { x: 9999, y: 9999 }, { x: 640, y: 400 }]) {
      const c = clampPoint(p, view, fab);
      expect(c.x).toBeGreaterThanOrEqual(AGENT_MARGIN);
      expect(c.y).toBeGreaterThanOrEqual(AGENT_MARGIN);
      expect(c.x + fab.w).toBeLessThanOrEqual(view.w - AGENT_MARGIN);
      expect(c.y + fab.h).toBeLessThanOrEqual(view.h - AGENT_MARGIN);
    }
    expect(clampPoint({ x: 640, y: 400 }, view, fab)).toEqual({ x: 640, y: 400 });
  });

  it("garde sa place relative quand la fenêtre change de taille", () => {
    const f = pointToFrac({ x: 100, y: 100 }, view, fab);
    const small = { w: 600, h: 500 };
    const p = fracToPoint(f, small, fab);
    expect(p.x).toBeGreaterThanOrEqual(AGENT_MARGIN);
    expect(p.x + fab.w).toBeLessThanOrEqual(small.w - AGENT_MARGIN);
    const corner = pointToFrac(fracToPoint({ fx: 1, fy: 1 }, view, fab), view, fab);
    expect(corner).toEqual({ fx: 1, fy: 1 });
  });

  it("tient compte d'une réserve en bas (barre, menu)", () => {
    const p = fracToPoint({ fx: 1, fy: 1 }, view, fab, AGENT_MARGIN, 64);
    expect(p.y + fab.h).toBe(view.h - AGENT_MARGIN - 64);
  });

  it("distingue un clic d'un déplacement", () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false);
    expect(isDrag({ x: 10, y: 10 }, { x: 30, y: 10 })).toBe(true);
  });

  it("relit une position mémorisée, et ignore une valeur corrompue", () => {
    expect(parseFrac('{"fx":0.25,"fy":0.5}')).toEqual({ fx: 0.25, fy: 0.5 });
    expect(parseFrac('{"fx":7,"fy":-3}')).toEqual({ fx: 1, fy: 0 });
    for (const bad of [null, "", "pas du json", '{"fx":"a","fy":1}', '{"fx":null}', "[]"]) expect(parseFrac(bad)).toBeNull();
  });
});

describe("panneau de discussion", () => {
  it("s'ouvre au-dessus du bouton quand la place suffit, aligné sur son bord le plus proche de l'écran", () => {
    const panel = panelSize(view);
    const right = placePanel({ x: 1200, y: 700 }, fab, view, panel);
    expect(right.y + panel.h).toBeLessThan(700);
    expect(right.x + panel.w).toBeCloseTo(1200 + 56, 0);
    const left = placePanel({ x: 40, y: 700 }, fab, view, panel);
    expect(left.x).toBe(40);
  });

  it("s'ouvre en dessous quand le bouton est tout en haut, et reste dans l'écran", () => {
    const panel = panelSize(view);
    const p = placePanel({ x: 600, y: 14 }, fab, view, panel);
    expect(p.y).toBeGreaterThanOrEqual(AGENT_MARGIN);
    expect(p.y + panel.h).toBeLessThanOrEqual(view.h - AGENT_MARGIN);
  });

  it("occupe la largeur d'un téléphone sans en sortir", () => {
    const phone = { w: 375, h: 667 };
    const panel = panelSize(phone);
    expect(panel.w).toBe(375 - 2 * AGENT_MARGIN);
    const p = placePanel({ x: 300, y: 600 }, fab, phone, panel);
    expect(p.x).toBeGreaterThanOrEqual(AGENT_MARGIN);
    expect(p.x + panel.w).toBeLessThanOrEqual(phone.w - AGENT_MARGIN);
    expect(p.y + panel.h).toBeLessThanOrEqual(phone.h - AGENT_MARGIN);
  });
});
