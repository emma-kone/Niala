import { describe, expect, it } from "vitest";
import { computeStreak, resolveActivityDay, streakMessage } from "./streak";

describe("computeStreak", () => {
  it("compte les jours consécutifs jusqu'à aujourd'hui", () => {
    const s = computeStreak(["2026-03-08", "2026-03-09", "2026-03-10"], "2026-03-10");
    expect(s).toMatchObject({ current: 3, longest: 3, doneToday: true, atRisk: false, lastDay: "2026-03-10", totalDays: 3 });
  });
  it("garde la série vivante (à risque) si hier est fait mais pas aujourd'hui", () => {
    const s = computeStreak(["2026-03-08", "2026-03-09"], "2026-03-10");
    expect(s).toMatchObject({ current: 2, doneToday: false, atRisk: true });
  });
  it("une journée manquée remet la série à zéro mais conserve le record", () => {
    const s = computeStreak(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-08"], "2026-03-10");
    expect(s).toMatchObject({ current: 0, longest: 4, atRisk: false });
  });
  it("une rupture puis une reprise repart de 1", () => {
    const s = computeStreak(["2026-03-01", "2026-03-02", "2026-03-05"], "2026-03-05");
    expect(s).toMatchObject({ current: 1, longest: 2 });
  });
  it("ignore les doublons du même jour", () => {
    const s = computeStreak(["2026-03-09", "2026-03-09", "2026-03-10", "2026-03-10"], "2026-03-10");
    expect(s).toMatchObject({ current: 2, totalDays: 2 });
  });
  it("traverse les fins de mois, d'année et le 29 février", () => {
    expect(computeStreak(["2027-12-31", "2028-01-01"], "2028-01-01").current).toBe(2);
    expect(computeStreak(["2028-02-28", "2028-02-29", "2028-03-01"], "2028-03-01").current).toBe(3);
  });
  it("traverse un changement d'heure sans perdre de jour", () => {
    expect(computeStreak(["2026-03-28", "2026-03-29", "2026-03-30"], "2026-03-30").current).toBe(3);
  });
  it("un jour enregistré dans le futur (voyage vers l'ouest) ne prolonge pas la série en cours", () => {
    const s = computeStreak(["2026-03-09", "2026-03-10", "2026-03-11"], "2026-03-10");
    expect(s.current).toBe(2);
    expect(s.longest).toBe(3);
    expect(s.lastDay).toBe("2026-03-10");
  });
  it("un jour entier manquant casse la série, même après un changement de fuseau", () => {
    expect(computeStreak(["2026-03-09", "2026-03-11"], "2026-03-11")).toMatchObject({ current: 1 });
  });
  it("sans activité", () => {
    expect(computeStreak([], "2026-03-10")).toMatchObject({ current: 0, longest: 0, lastDay: null, atRisk: false });
  });
  it("ignore les dates invalides et fournit la semaine", () => {
    const s = computeStreak(["pas une date", "2026-03-10"], "2026-03-10");
    expect(s.totalDays).toBe(1);
    expect(s.week).toHaveLength(7);
    expect(s.week[6]).toEqual({ date: "2026-03-10", active: true });
    expect(s.week[0].date).toBe("2026-03-04");
  });
});

describe("resolveActivityDay", () => {
  const now = new Date("2026-03-10T23:30:00Z");
  it("retient la date de l'appareil, à un jour près du serveur", () => {
    expect(resolveActivityDay("2026-03-11", now)).toBe("2026-03-11");
    expect(resolveActivityDay("2026-03-09", now)).toBe("2026-03-09");
  });
  it("retombe sur la date du serveur si la date est absente, invalide ou trop éloignée", () => {
    expect(resolveActivityDay(null, now)).toBe("2026-03-10");
    expect(resolveActivityDay("2026-13-45", now)).toBe("2026-03-10");
    expect(resolveActivityDay("2027-01-01", now)).toBe("2026-03-10");
  });
});

describe("streakMessage", () => {
  const base = { current: 0, longest: 0, doneToday: false, atRisk: false, totalDays: 0 };
  it("couvre chaque état", () => {
    expect(streakMessage(base)).toMatch(/commencer/);
    expect(streakMessage({ ...base, totalDays: 4, current: 3, atRisk: true, longest: 3 })).toMatch(/3 jours/);
    expect(streakMessage({ ...base, totalDays: 4, longest: 4 })).toMatch(/record est de 4/);
    expect(streakMessage({ ...base, totalDays: 4, current: 3, longest: 3, doneToday: true })).toMatch(/meilleure/);
    expect(streakMessage({ ...base, totalDays: 9, current: 2, longest: 5, doneToday: true })).toMatch(/4 de plus/);
  });
});
