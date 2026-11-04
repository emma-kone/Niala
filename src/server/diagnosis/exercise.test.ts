import { describe, expect, it } from "vitest";
import { bestNumericRelation, parseNumber } from "@/server/domain/numeric";
import { gradeObjective } from "@/server/domain/exercise-grading";
import { analyzeExerciseAnswer, editDistance, nearMiss } from "./analyzers/exercise";
import { buildReport } from "./engine";

describe("validation numérique", () => {
  it("lit les écritures usuelles", () => {
    expect(parseNumber("0,5")?.value).toBe(0.5);
    expect(parseNumber("1/2")?.value).toBe(0.5);
    expect(parseNumber("50 %")?.value).toBe(0.5);
    expect(parseNumber("1 234,5")?.value).toBe(1234.5);
    expect(parseNumber("1.234,5")?.value).toBe(1234.5);
    expect(parseNumber("1,234.5")?.value).toBe(1234.5);
    expect(parseNumber("x = 12 cm")).toMatchObject({ value: 12, unit: "cm" });
    expect(parseNumber("1e3")?.value).toBe(1000);
    expect(parseNumber("−4")?.value).toBe(-4);
    expect(parseNumber("trois")).toBeNull();
    expect(parseNumber("1/0")).toBeNull();
  });

  it("compare des valeurs, pas des chaînes", () => {
    expect(bestNumericRelation("0,50", ["1/2"])?.relation).toBe("equal");
    expect(bestNumericRelation("3.14", ["3.14159"])?.relation).toBe("rounded");
    expect(bestNumericRelation("3", ["3.14159"])?.relation).toBe("different");
    expect(bestNumericRelation("-5", ["5"])?.relation).toBe("opposite");
    expect(bestNumericRelation("50", ["0.5"])?.relation).toBe("power_of_ten");
    expect(bestNumericRelation("11", ["10"])?.relation).toBe("off_by_one");
    expect(bestNumericRelation("12 m", ["12 cm"])?.relation).toBe("different");
    expect(bestNumericRelation("12", ["12 cm"])?.relation).toBe("equal");
    expect(bestNumericRelation("bonjour", ["12"])).toBeNull();
    expect(bestNumericRelation("12", ["douze"])).toBeNull();
  });

  it("la correction des réponses courtes utilise les valeurs", () => {
    const key = { accepted: ["0.5", "1/2"] };
    expect(gradeObjective("short_answer", key, "50 %", 2)).toMatchObject({ verdict: "correct", points: 2 });
    expect(gradeObjective("short_answer", key, "0,5", 2)).toMatchObject({ verdict: "correct" });
    const wrong = gradeObjective("short_answer", { accepted: ["5"] }, "-5", 2)!;
    expect(wrong.verdict).toBe("incorrect");
    expect(wrong.detail).toMatchObject({ numeric: { relation: "opposite" } });
    expect(gradeObjective("short_answer", { accepted: ["Paris"] }, "paris", 1)).toMatchObject({ verdict: "correct" });
  });
});

describe("analyse des exercices classiques", () => {
  it("distance d'édition et fautes de frappe", () => {
    expect(editDistance("polymorphisme", "polymorphisme")).toBe(0);
    expect(editDistance("heritage", "héritage")).toBeGreaterThanOrEqual(1);
    expect(nearMiss("polimorphisme", ["polymorphisme"])).toBe("polymorphisme");
    expect(nearMiss("encapsulation", ["polymorphisme"])).toBeNull();
    expect(nearMiss("un", ["une"])).toBeNull();
  });

  it("4. confusion entre deux notions : associations échangées (fait) → hypothèse de confusion", () => {
    const key = { pairs: { classe: "modèle", objet: "instance", méthode: "fonction" } };
    const value = { classe: "instance", objet: "modèle", méthode: "fonction" };
    const g = gradeObjective("matching", key, value, 3)!;
    const o = analyzeExerciseAnswer("matching", key, value, g);
    expect(o.facts.join(" ")).toContain("échangées");
    expect(o.diagnoses[0]).toMatchObject({ category: "CONCEPT" });
    expect(o.diagnoses[0].confidence).toBeGreaterThan(0.6);
    expect(o.diagnoses[0].confidence).toBeLessThan(0.8);
    const r = buildReport({ activity: "EXERCISE", status: "fail", diagnoses: o.diagnoses, concepts: [{ name: "Classe et objet" }] });
    expect(r).toMatchObject({ primary: "CONCEPT", needsVerification: true, recommendedAction: "clarifying_question" });
  });

  it("QCM multiple : omission (oubli possible) distinguée d'une proposition fausse cochée", () => {
    const key = { correct: ["a", "b", "c"] };
    const gMissing = gradeObjective("qcm_multiple", key, ["a", "b"], 3)!;
    expect(analyzeExerciseAnswer("qcm_multiple", key, ["a", "b"], gMissing).diagnoses[0].category).toBe("FORGETTING");
    const gWrong = gradeObjective("qcm_multiple", key, ["a", "d"], 3)!;
    expect(analyzeExerciseAnswer("qcm_multiple", key, ["a", "d"], gWrong).diagnoses[0].category).toBe("CONCEPT");
  });

  it("une seule mauvaise réponse à un QCM : hypothèse faible, jamais une gravité élevée", () => {
    const g = gradeObjective("qcm_single", { correct: ["b"] }, "a", 1)!;
    const o = analyzeExerciseAnswer("qcm_single", { correct: ["b"] }, "a", g);
    const r = buildReport({ activity: "EXERCISE", status: "fail", diagnoses: o.diagnoses, concepts: [{ name: "Héritage" }] });
    expect(r).toMatchObject({ primary: "CONCEPT", needsVerification: true, severity: "medium" });
    expect(r.confidence).toBeLessThan(0.5);
    const again = buildReport({ activity: "EXERCISE", status: "fail", diagnoses: o.diagnoses, concepts: [{ name: "Héritage" }], history: { sameCategory: 2, priorSuccesses: 0, hintsUsed: 0 } });
    expect(again.severity).toBe("high");
  });

  it("réponse courte : faute de frappe = étourderie possible ; réponse sans rapport = notion à revoir", () => {
    const key = { accepted: ["polymorphisme"] };
    const typo = gradeObjective("short_answer", key, "polimorphisme", 1)!;
    expect(analyzeExerciseAnswer("short_answer", key, "polimorphisme", typo).diagnoses[0]).toMatchObject({ category: "CARELESS" });
    const off = gradeObjective("short_answer", key, "encapsulation", 1)!;
    expect(analyzeExerciseAnswer("short_answer", key, "encapsulation", off).diagnoses[0]).toMatchObject({ category: "CONCEPT" });
  });

  it("calcul : l'écart de signe est constaté (fait) et l'étourderie seulement suggérée (hypothèse)", () => {
    const key = { accepted: ["12"] };
    const g = gradeObjective("short_answer", key, "-12", 2)!;
    const o = analyzeExerciseAnswer("short_answer", key, "-12", g);
    expect(o.facts.join(" ")).toContain("opposé");
    expect(o.diagnoses.map((x) => x.category)).toEqual(["LOGIC", "CARELESS"]);
    expect(o.diagnoses[0].confidence).toBeGreaterThan(o.diagnoses[1].confidence);
    const r = buildReport({ activity: "EXERCISE", status: "fail", diagnoses: o.diagnoses, concepts: [{ name: "Calcul" }] });
    expect(r.primary).toBe("LOGIC");
    expect(r.secondary).toContain("CARELESS");
  });

  it("10. réponse ouverte partiellement correcte : éléments manquants listés, jamais une note inventée", () => {
    const g = { verdict: "partial", detail: { criteria: [{ label: "Définit l'héritage", met: true }, { label: "Cite un exemple", met: false }, { label: "Mentionne la réutilisation", met: false }] } };
    const o = analyzeExerciseAnswer("open", {}, "L'héritage permet de dériver une classe.", g);
    expect(o.facts[0]).toContain("Cite un exemple");
    expect(o.diagnoses[0]).toMatchObject({ category: "FORGETTING" });
    expect(o.diagnoses[0].label).toContain("2");
  });

  it("textes à compléter : trous presque justes = faute de frappe possible", () => {
    const key = { answers: { b1: ["polymorphisme"], b2: ["héritage"] } };
    const value = { b1: "polimorphisme", b2: "heritage" };
    const g = gradeObjective("fill_blank", key, value, 2)!;
    const o = analyzeExerciseAnswer("fill_blank", key, value, g);
    expect(g.verdict).not.toBe("incorrect");
    expect(o.diagnoses.some((x) => x.category === "CARELESS")).toBe(true);
  });
});
