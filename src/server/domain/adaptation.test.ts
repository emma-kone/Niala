import { describe, expect, it } from "vitest";
import { buildAdaptations, type ConceptView } from "./recommend";

const concept = (o: Partial<ConceptView & { state: string }>): ConceptView & { state: string } => ({ id: "c1", name: "Boucles", subjectId: "s1", importance: 3, level: 0.5, confidence: 0.6, evidenceCount: 3, lastEvidenceAt: new Date(), prerequisites: [], state: "ACQUIRING", ...o });

describe("recommandations adaptées au diagnostic", () => {
  it("logique qui se répète (et non la syntaxe) : exercices de raisonnement et de cas limites, justifiés par les observations", () => {
    const recs = buildAdaptations({ concepts: [], confusions: [], recurring: [{ skill: "cas-limites", label: "Gestion des cas limites", occurrences: 4, subjectId: "s1" }, { skill: "syntaxe", label: "Écriture correcte des instructions", occurrences: 9, subjectId: "s1" }] });
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ type: "LAB", subjectId: "s1", evidence: { adaptation: "edge_cases", skill: "cas-limites", count: 4 } });
    expect(recs[0].text).toContain("la syntaxe n'est pas en cause");
  });

  it("une difficulté trop rare ou sans matière n'est pas recommandée", () => {
    expect(buildAdaptations({ concepts: [], confusions: [], recurring: [{ skill: "cas-limites", label: "x", occurrences: 2, subjectId: "s1" }] })).toEqual([]);
    expect(buildAdaptations({ concepts: [], confusions: [], recurring: [{ skill: "cas-limites", label: "x", occurrences: 5, subjectId: null }] })).toEqual([]);
  });

  it("confusion répétée entre notions : exercice de comparaison, seulement à partir de deux observations", () => {
    const concepts = [concept({ id: "c1", name: "Classe et objet" })];
    expect(buildAdaptations({ concepts, recurring: [], confusions: [{ conceptId: "c1", count: 1 }] })).toEqual([]);
    const [r] = buildAdaptations({ concepts, recurring: [], confusions: [{ conceptId: "c1", count: 3 }] });
    expect(r).toMatchObject({ type: "EXERCISE", conceptId: "c1", evidence: { adaptation: "compare", count: 3 } });
    expect(r.text).toContain("évoque une confusion possible");
  });

  it("notion maîtrisée sur plusieurs observations : difficulté supérieure ; jamais pour une notion fragile ou peu observée", () => {
    const list = [concept({ id: "m", name: "Variables", state: "CONFIRMED", evidenceCount: 6 }), concept({ id: "f", name: "Pointeurs", state: "FRAGILE", evidenceCount: 6 }), concept({ id: "n", name: "Tableaux", state: "MASTERED", evidenceCount: 2 })];
    const recs = buildAdaptations({ concepts: list, recurring: [], confusions: [] });
    expect(recs.map((r) => r.conceptId)).toEqual(["m"]);
    expect(recs[0].evidence.adaptation).toBe("harder");
  });

  it("rien à recommander sans observation : aucune adaptation inventée", () => {
    expect(buildAdaptations({ concepts: [concept({ state: "NOT_ASSESSED", evidenceCount: 0 })], recurring: [], confusions: [] })).toEqual([]);
  });
});
