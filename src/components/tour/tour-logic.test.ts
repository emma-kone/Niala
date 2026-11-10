import { describe, expect, it } from "vitest";
import { ADMIN_TOUR, STUDENT_TOUR } from "@/features/tour/steps";
import { keepVisibleSteps, placePopover, storageKey } from "@/components/tour/tour-logic";

const view = { w: 1280, h: 800 };
const pop = { w: 340, h: 200 };

describe("placement de la carte de visite guidée", () => {
  it("centre la carte quand il n'y a pas de cible", () => {
    expect(placePopover(null, view, pop)).toEqual({ top: 300, left: 470, side: "center" });
  });

  it("se place à droite d'un lien de la barre latérale, sans sortir de l'écran", () => {
    const p = placePopover({ top: 120, left: 10, width: 150, height: 36 }, view, pop, "right");
    expect(p.side).toBe("right");
    expect(p.left).toBe(10 + 150 + 14);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.top + pop.h).toBeLessThanOrEqual(view.h - 12);
  });

  it("choisit un autre côté quand le côté préféré manque de place", () => {
    const nearBottom = placePopover({ top: 760, left: 500, width: 100, height: 30 }, view, pop, "bottom");
    expect(nearBottom.side).not.toBe("bottom");
    const nearRight = placePopover({ top: 300, left: 1200, width: 70, height: 30 }, view, pop, "right");
    expect(nearRight.side).not.toBe("right");
    expect(nearRight.left + pop.w).toBeLessThanOrEqual(view.w - 12);
  });

  it("reste entièrement visible même sur un petit écran", () => {
    const phone = { w: 375, h: 640 };
    for (const t of [{ top: 10, left: 5, width: 360, height: 40 }, { top: 580, left: 300, width: 60, height: 40 }, { top: 300, left: 0, width: 30, height: 30 }]) {
      const p = placePopover(t, phone, { w: 340, h: 200 });
      expect(p.left).toBeGreaterThanOrEqual(12);
      expect(p.top).toBeGreaterThanOrEqual(12);
      expect(p.left + 340).toBeLessThanOrEqual(phone.w - 12 + 0.001);
      expect(p.top + 200).toBeLessThanOrEqual(phone.h - 12 + 0.001);
    }
  });
});

describe("étapes de visite", () => {
  it("ignore les étapes dont la cible est masquée et garde l'accueil et la conclusion", () => {
    const kept = keepVisibleSteps(STUDENT_TOUR, () => false);
    expect(kept.map((s) => s.id)).toEqual(["welcome", "done"]);
    expect(keepVisibleSteps(STUDENT_TOUR, () => true)).toHaveLength(STUDENT_TOUR.length);
  });

  it("a des étapes uniques, rédigées, et cible les modules réels de chaque plateforme", () => {
    for (const tour of [STUDENT_TOUR, ADMIN_TOUR]) {
      expect(new Set(tour.map((s) => s.id)).size).toBe(tour.length);
      expect(tour.every((s) => s.title.length > 3 && s.body.length > 20)).toBe(true);
      expect(tour[0].selector).toBeUndefined();
      expect(tour.at(-1)!.selector).toBeUndefined();
    }
    const hrefs = (t: typeof STUDENT_TOUR) => t.flatMap((s) => [...(s.selector ?? "").matchAll(/href="([^"]+)"/g)].map((m) => m[1]));
    expect(hrefs(STUDENT_TOUR)).toEqual(expect.arrayContaining(["/matieres", "/exercices", "/assistant", "/progression", "/suggestions", "/reglages"]));
    expect(hrefs(ADMIN_TOUR)).toHaveLength(12);
  });

  it("mémorise la visite par visite, compte et version", () => {
    expect(storageKey("student", "u1", 1)).not.toBe(storageKey("student", "u2", 1));
    expect(storageKey("student", "u1", 1)).not.toBe(storageKey("student", "u1", 2));
    expect(storageKey("student", "u1", 1)).not.toBe(storageKey("admin", "u1", 1));
  });
});
