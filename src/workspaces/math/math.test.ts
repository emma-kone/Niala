import { describe, expect, it } from "vitest";
import { candidates, equationsEquivalent, equivalent, firstStepProblem, gradeMath, matchesAnswer, sampleFunction, variablesOf } from "./logic";
import { emptyMath, mathReferenceSchema, readMath, type MathWork } from "./model";

const work = (steps: string[], result = "", label = "Q1"): MathWork => ({ parts: [{ id: "p", label, steps: steps.map((a, i) => ({ id: `s${i}`, latex: a, ascii: a, note: "" })), result: { latex: result, ascii: result } }], graph: null });
const ref = (...answers: string[][]) => mathReferenceSchema.parse({ parts: answers.map((a) => ({ answers: a })) });

describe("équivalence", () => {
  it("reconnaît des expressions équivalentes et refuse les autres", () => {
    expect(equivalent("(x+1)^2", "x^2+2x+1")).toBe(true);
    expect(equivalent("(x+1)^2", "x^2+1")).toBe(false);
    expect(equivalent("sin(x)^2+cos(x)^2", "1")).toBe(true);
    expect(equivalent("2+3*4", "14")).toBe(true);
    expect(equivalent("2+3*4", "20")).toBe(false);
    expect(equivalent("(1)/(2)", "0.5")).toBe(true);
  });
  it("ne conclut pas quand l'expression est illisible", () => {
    expect(equivalent("x +* 2", "x")).toBeNull();
    expect(equivalent("", "x")).toBeNull();
  });
  it("compare des équations à un facteur et un déplacement de termes près", () => {
    expect(equationsEquivalent("2x+3=7", "2x=4")).toBe(true);
    expect(equationsEquivalent("2x+3=7", "x=2")).toBe(true);
    expect(equationsEquivalent("2x+3=7", "x=3")).toBe(false);
  });
  it("lit les variables sans compter fonctions et constantes", () => {
    expect(variablesOf("sin(x)+pi*y").sort()).toEqual(["x", "y"]);
  });
  it("refuse les fonctions dangereuses du moteur", () => {
    expect(equivalent("import(1)", "1")).toBeNull();
    expect(equivalent("evaluate('1')", "1")).toBeNull();
  });
});

describe("étapes de résolution", () => {
  it("ne trouve rien à redire à un raisonnement correct", () => {
    expect(firstStepProblem(work(["2x+3=7", "2x=4", "x=2"]).parts[0].steps)).toBeNull();
  });
  it("identifie la première étape fausse, et distingue calcul et méthode", () => {
    const method = firstStepProblem(work(["2x+3=7", "2x=10", "x=5"]).parts[0].steps);
    expect(method).toMatchObject({ index: 1, kind: "methode" });
    const calc = firstStepProblem(work(["3*4+2", "12+2", "15"]).parts[0].steps);
    expect(calc).toMatchObject({ index: 2, kind: "calcul" });
  });
});

describe("résultat final", () => {
  it("accepte « x = 2 », plusieurs solutions et des formes équivalentes", () => {
    expect(candidates("x = 1 ou x = 2")).toEqual(["1", "2"]);
    expect(matchesAnswer("x=2", ["2"])).toBe(true);
    expect(matchesAnswer("x = 2 ou x = 1", ["1", "2"])).toBe(true);
    expect(matchesAnswer("x = 1", ["1", "2"])).toBe(false);
    expect(matchesAnswer("x = 1 ou x = 2 ou x = 3", ["1", "2"])).toBe(false);
    expect(matchesAnswer("(4)/(2)", ["2"])).toBe(true);
  });
});

describe("note d'une production", () => {
  it("note pleine pour un résultat juste avec étapes cohérentes", () => {
    expect(gradeMath(work(["2x+3=7", "2x=4", "x=2"], "x=2"), ref(["2"])).ratio).toBeCloseTo(1, 5);
  });
  it("garde les points du résultat quand les étapes sont fausses, et retire ceux des étapes", () => {
    const g = gradeMath(work(["2x+3=7", "2x=10", "x=2"], "x=2"), ref(["2"]));
    expect(g.ratio).toBeGreaterThan(0.6);
    expect(g.ratio).toBeLessThan(1);
    expect(g.problems[0].problem.index).toBe(1);
  });
  it("juge uniquement la démarche s'il n'y a pas de référence, et note zéro pour une copie vide", () => {
    expect(gradeMath(work(["1+1", "2"]), null).ratio).toBe(1);
    expect(gradeMath(emptyMath(), ref(["2"])).ratio).toBe(0);
  });
  it("note chaque partie selon son barème", () => {
    const w: MathWork = { parts: [work(["1+1"], "2").parts[0], work(["1+1"], "3", "Q2").parts[0]], graph: null };
    const g = gradeMath(w, mathReferenceSchema.parse({ parts: [{ answers: ["2"], points: 1 }, { answers: ["2"], points: 3 }] }));
    expect(g.ratio).toBeCloseTo((1 * 1 + 3 * 0.4) / 4, 5);
  });
  it("lit sans erreur une production abîmée", () => {
    expect(readMath(42)).toEqual(emptyMath());
  });
});

describe("tracé", () => {
  it("échantillonne une fonction et coupe aux points non définis", () => {
    const pts = sampleFunction("1/x", -1, 1, 20);
    expect(pts.length).toBe(21);
    expect(pts.filter((p) => p.y === null)).toHaveLength(1); // x = 0 : division par zéro
    const s = sampleFunction("sqrt(x)", -2, 2, 20);
    expect(s.filter((p) => p.y === null).length).toBeGreaterThan(5);
    expect(sampleFunction("x +* 2", -1, 1)).toEqual([]);
  });
});
