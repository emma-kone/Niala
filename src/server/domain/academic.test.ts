import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, dueReminders, effectiveStatus, freeWindows, isQuiet, planStudySessions, type PlanInput } from "./academic";

const facts = (over = {}) => ({ status: "EN_COURS" as const, dueDate: "2026-11-10", dueMinutes: 720, requiresSubmission: false, ...over });
const plan = (over: Partial<PlanInput> = {}): PlanInput => ({ today: "2026-11-09", nowMinutes: 480, dueDate: "2026-11-12", dueMinutes: 1080, estimatedMinutes: 180, busy: [], prefs: DEFAULT_PREFS, ...over });

describe("statut réel d'une échéance", () => {
  it("devient en retard à l'heure limite, pas avant", () => {
    expect(effectiveStatus(facts(), "2026-11-10", 719)).toBe("EN_COURS");
    expect(effectiveStatus(facts(), "2026-11-10", 720)).toBe("EN_RETARD");
  });
  it("sans heure, reste à temps toute la journée", () => {
    expect(effectiveStatus(facts({ dueMinutes: null }), "2026-11-10", 1439)).toBe("EN_COURS");
    expect(effectiveStatus(facts({ dueMinutes: null }), "2026-11-11", 0)).toBe("EN_RETARD");
  });
  it("distingue terminé et soumis", () => {
    expect(effectiveStatus(facts({ status: "TERMINE" }), "2026-12-01", 0)).toBe("TERMINE");
    expect(effectiveStatus(facts({ status: "TERMINE", requiresSubmission: true }), "2026-12-01", 0)).toBe("EN_RETARD");
    expect(effectiveStatus(facts({ status: "SOUMIS", requiresSubmission: true }), "2026-12-01", 0)).toBe("SOUMIS");
    expect(effectiveStatus(facts({ status: "ANNULE" }), "2026-12-01", 0)).toBe("ANNULE");
  });
});

describe("planification", () => {
  it("laisse du repos autour d'un cours", () => {
    const windows = freeWindows("2026-11-10", plan({ busy: [{ date: "2026-11-10", startMinutes: 990, endMinutes: 1080 }] }));
    expect(windows).toEqual([[1095, 1260]]);
  });
  it("répartit le travail et respecte la limite quotidienne", () => {
    const r = planStudySessions(plan({ estimatedMinutes: 300 }));
    expect(r.feasible).toBe(true);
    const perDay = new Map<string, number>();
    for (const s of r.sessions) perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.endMinutes - s.startMinutes);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(DEFAULT_PREFS.maxDailyMinutes);
    expect(r.plannedMinutes).toBe(300);
  });
  it("garde une marge avant l'échéance", () => {
    const r = planStudySessions(plan({ today: "2026-11-12", dueDate: "2026-11-12", dueMinutes: 1200, estimatedMinutes: 240 }));
    expect(Math.max(...r.sessions.map((s) => s.endMinutes))).toBeLessThanOrEqual(1080);
    expect(r.feasible).toBe(false);
  });
  it("ne propose rien après une date limite passée, et le dit", () => {
    const r = planStudySessions(plan({ dueDate: "2026-11-01" }));
    expect(r).toMatchObject({ feasible: false, sessions: [] });
    expect(r.message).toContain("passée");
  });
  it("sans week-end, n'en propose aucun", () => {
    const r = planStudySessions(plan({ today: "2026-11-14", dueDate: "2026-11-17", prefs: { ...DEFAULT_PREFS, weekends: false } }));
    expect(r.sessions.every((s) => !["2026-11-14", "2026-11-15"].includes(s.date))).toBe(true);
  });
});

describe("rappels", () => {
  const prefs = { quietStart: 1320, quietEnd: 420 };
  it("reconnaît les heures de tranquillité qui passent minuit", () => {
    expect([isQuiet(1380, prefs), isQuiet(60, prefs), isQuiet(420, prefs), isQuiet(720, prefs)]).toEqual([true, true, false, false]);
  });
  it("se déclenche au bon moment et rattrape dans la fenêtre", () => {
    const task = { dueDate: "2026-11-10", dueMinutes: 720, reminderMinutes: [1440] };
    expect(dueReminders(task, "2026-11-09", 720, prefs)).toEqual([1440]);
    expect(dueReminders(task, "2026-11-09", 719, prefs)).toEqual([]);
    expect(dueReminders(task, "2026-11-09", 750, prefs, 60)).toEqual([1440]);
    expect(dueReminders(task, "2026-11-09", 790, prefs, 60)).toEqual([]);
  });
  it("se tait pendant la tranquillité", () => {
    expect(dueReminders({ dueDate: "2026-11-10", dueMinutes: 1380, reminderMinutes: [1440] }, "2026-11-09", 1380, prefs)).toEqual([]);
  });
});
