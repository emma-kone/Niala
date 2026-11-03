import { describe, expect, it } from "vitest";
import { answerEvidenceScore, estimateMastery, masteryBand, type Evidence } from "./mastery";
import { buildRecommendations, type ConceptView } from "./recommend";

const now = new Date("2026-11-01T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const ev = (score: number, d = 0, source = "a1", weight = 1): Evidence => ({ score, weight, at: daysAgo(d), source });

describe("estimation de maîtrise", () => {
  it("sans preuve : confiance nulle, « pas assez de données »", () => {
    const e = estimateMastery([], now);
    expect(e).toMatchObject({ confidence: 0, evidenceCount: 0, lastEvidenceAt: null });
    expect(masteryBand(e.level, e.confidence)).toBe("unknown");
  });

  it("une seule bonne réponse ne prouve pas la maîtrise ; une seule mauvaise ne condamne pas", () => {
    const good = estimateMastery([ev(1)], now);
    expect(good.confidence).toBeLessThan(0.35);
    expect(masteryBand(good.level, good.confidence)).toBe("unknown");
    expect(good.level).toBeLessThan(0.9);
    const bad = estimateMastery([ev(0)], now);
    expect(bad.level).toBeGreaterThan(0.1);
  });

  it("la confiance croît avec le nombre de preuves ; la maîtrise suit les résultats", () => {
    const few = estimateMastery([ev(1, 0, "a"), ev(1, 0, "a")], now);
    const many = estimateMastery(Array.from({ length: 8 }, (_, i) => ev(1, i, `a${i % 3}`)), now);
    expect(many.confidence).toBeGreaterThan(few.confidence);
    expect(many.level).toBeGreaterThan(0.8);
    expect(masteryBand(many.level, many.confidence)).toBe("solid");
    const weak = estimateMastery(Array.from({ length: 6 }, (_, i) => ev(0, i, `a${i % 3}`)), now);
    expect(weak.level).toBeLessThan(0.2);
    expect(masteryBand(weak.level, weak.confidence)).toBe("fragile");
  });

  it("les preuves anciennes pèsent moins : les résultats récents l'emportent", () => {
    const improving = estimateMastery([ev(0, 90, "a"), ev(0, 80, "b"), ev(1, 1, "c"), ev(1, 0, "d")], now);
    const declining = estimateMastery([ev(1, 90, "a"), ev(1, 80, "b"), ev(0, 1, "c"), ev(0, 0, "d")], now);
    expect(improving.level).toBeGreaterThan(declining.level);
    expect(improving.lastEvidenceAt).toEqual(daysAgo(0));
  });

  it("une question difficile pèse plus qu'une facile", () => {
    const hardFail = estimateMastery([ev(0, 0, "a", 1.3), ev(1, 0, "b", 0.7)], now);
    const easyFail = estimateMastery([ev(0, 0, "a", 0.7), ev(1, 0, "b", 1.3)], now);
    expect(hardFail.level).toBeLessThan(easyFail.level);
  });

  it("score d'une réponse : non corrigée = aucune preuve, passée = 0", () => {
    expect(answerEvidenceScore("ungraded", null, 2)).toBeNull();
    expect(answerEvidenceScore("skipped", 0, 2)).toBe(0);
    expect(answerEvidenceScore("partial", 1, 2)).toBe(0.5);
    expect(answerEvidenceScore(null, null, 2)).toBeNull();
  });
});

const cv = (o: Partial<ConceptView> & { id: string }): ConceptView => ({ name: o.id, subjectId: "s1", importance: 2, level: 0, confidence: 0, evidenceCount: 0, lastEvidenceAt: null, prerequisites: [], ...o });

describe("recommandations", () => {
  it("notion fragile et mesurée → exercice ciblé, avec raison et preuves chiffrées", () => {
    const r = buildRecommendations([cv({ id: "c1", name: "Jointures", level: 0.25, confidence: 0.6, evidenceCount: 6, lastEvidenceAt: daysAgo(2) })], [], now);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ type: "EXERCISE", conceptId: "c1" });
    expect(r[0].text).toMatch(/25 %.*6 réponse/);
    expect(r[0].evidence).toMatchObject({ level: 0.25, evidenceCount: 6 });
  });

  it("jamais de conclusion « fragile » sans confiance suffisante", () => {
    expect(buildRecommendations([cv({ id: "c1", level: 0.1, confidence: 0.2, evidenceCount: 1, lastEvidenceAt: daysAgo(1) })], [], now)).toEqual([]);
  });

  it("un prérequis fragile passe avant la notion qui en dépend", () => {
    const pre = { id: "p1", name: "Algèbre", level: 0.2, confidence: 0.6, evidenceCount: 5 };
    const r = buildRecommendations([cv({ id: "c1", name: "Équations", level: 0.3, confidence: 0.6, evidenceCount: 5, prerequisites: [pre] })], [], now);
    expect(r[0]).toMatchObject({ conceptId: "p1" });
    expect(r[0].text).toMatch(/prérequis/);
  });

  it("notion principale jamais évaluée → mesurer ; notion solide ancienne → révision espacée", () => {
    const r = buildRecommendations(
      [cv({ id: "c1", name: "Clé primaire", importance: 3 }), cv({ id: "c2", name: "Index", level: 0.85, confidence: 0.7, evidenceCount: 6, lastEvidenceAt: daysAgo(60) }), cv({ id: "c3", name: "Vue", importance: 1 })],
      [],
      now,
    );
    expect(r.map((x) => [x.type, x.conceptId])).toEqual([["EXERCISE", "c1"], ["REVIEW", "c2"]]);
  });

  it("erreur récurrente en laboratoire (≥ 3) → entraînement ciblé ; sinon rien", () => {
    const tally = { kind: "edge_case", category: "LOGIC", count: 4, label: "Les cas limites échouent.", subjectId: "s1", labKind: "SQL" as const };
    expect(buildRecommendations([], [tally], now)[0]).toMatchObject({ type: "LAB", evidence: { labKind: "SQL", count: 4 } });
    expect(buildRecommendations([], [{ ...tally, count: 2 }], now)).toEqual([]);
  });

  it("classe par priorité et plafonne", () => {
    const list = Array.from({ length: 12 }, (_, i) => cv({ id: `c${i}`, level: 0.1 + i * 0.03, confidence: 0.7, evidenceCount: 5, lastEvidenceAt: daysAgo(1) }));
    const r = buildRecommendations(list, [], now, 5);
    expect(r).toHaveLength(5);
    expect(r.map((x) => x.priority)).toEqual([...r.map((x) => x.priority)].sort((a, b) => b - a));
  });
});
