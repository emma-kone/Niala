import { describe, expect, it } from "vitest";
import { classify, compareResultSets, compareStdout, jsonEqual, parseCodeTests, sqlErrorReason, sqlSpecSchema, summarize, type TestOutcome } from "./lab-tests";

const rs = (columns: string[], rows: unknown[][]) => ({ columns, rows });
const o = (p: Partial<TestOutcome>): TestOutcome => ({ id: "x", name: "t", edge: false, hidden: false, weight: 1, status: "pass", ...p });

describe("comparaisons", () => {
  it("stdout : ignore les espaces de fin, distingue contenu et présentation", () => {
    expect(compareStdout("a\nb\n", "a  \r\nb")).toEqual({ ok: true, format: false });
    expect(compareStdout("Total : 12", "total 12")).toEqual({ ok: false, format: true });
    expect(compareStdout("12", "13")).toEqual({ ok: false, format: false });
  });

  it("JSON : tolérance numérique, ordre des clés ignoré, tableaux ordonnés", () => {
    expect(jsonEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual(null, 0)).toBe(false);
  });

  it("SQL : lignes manquantes, en trop, valeurs, ordre, colonnes", () => {
    const exp = rs(["n"], [["a"], ["b"], ["c"]]);
    const spec = { ordered: false, strictColumns: false };
    expect(compareResultSets(exp, rs(["x"], [["c"], ["a"], ["b"]]), spec, false).status).toBe("pass");
    expect(compareResultSets(exp, rs(["n"], [["a"], ["b"]]), spec, false)).toMatchObject({ reason: "rows_missing" });
    expect(compareResultSets(exp, rs(["n"], [["a"], ["b"], ["c"], ["d"]]), spec, false)).toMatchObject({ reason: "rows_extra" });
    expect(compareResultSets(exp, rs(["n"], [["a"], ["b"], ["z"]]), spec, false)).toMatchObject({ reason: "values" });
    expect(compareResultSets(exp, rs(["n", "m"], [["a", 1]]), spec, false)).toMatchObject({ reason: "columns" });
    expect(compareResultSets(exp, rs(["n"], [["c"], ["a"], ["b"]]), { ordered: true, strictColumns: false }, false)).toMatchObject({ reason: "order" });
    expect(compareResultSets(exp, rs(["x"], [["a"], ["b"], ["c"]]), { ordered: false, strictColumns: true }, false)).toMatchObject({ reason: "columns" });
  });

  it("SQL : ne montre pas les lignes attendues d'un test caché ; NULL et nombres normalisés", () => {
    const r = compareResultSets(rs(["n"], [[1], [2]]), rs(["n"], [[1]]), { ordered: false, strictColumns: false }, true);
    expect(r.expected).toBeUndefined();
    expect(compareResultSets(rs(["v"], [[0.1 + 0.2], [null]]), rs(["v"], [[0.3], [null]]), { ordered: false, strictColumns: false }, false).status).toBe("pass");
  });
});

describe("tests et score", () => {
  it("ne garde que les tests valides", () => {
    const tests = parseCodeTests([
      { name: "ok", call: { fn: "f", args: [1] }, expected: 2 },
      { name: "sortie", expected: "x\n", stdin: "1" },
      { name: "fonction invalide", call: { fn: "f; process.exit()", args: [] }, expected: 1 },
      { name: "sans attendu", call: { fn: "f", args: [] } },
      { expected: 1 },
      { name: "stdout non texte", expected: 12 },
    ]);
    expect(tests.map((t) => t.name)).toEqual(["ok", "sortie"]);
    expect(tests[0]).toMatchObject({ edge: false, hidden: false, weight: 1 });
  });

  it("score pondéré et cas limites", () => {
    const s = summarize([o({ status: "pass", weight: 1 }), o({ status: "fail", weight: 3 }), o({ status: "pass", edge: true, weight: 1 }), o({ status: "error", edge: true, weight: 1 })]);
    expect(s).toMatchObject({ passed: 2, total: 4, edgePassed: 1, edgeTotal: 2, allPassed: false });
    expect(s.ratio).toBeCloseTo(2 / 6);
    expect(summarize([o({}), o({})]).allPassed).toBe(true);
    expect(summarize([]).allPassed).toBe(false);
  });

  it("schéma SQL : valeurs par défaut et bornes", () => {
    expect(sqlSpecSchema.parse({ referenceSql: "SELECT 1" })).toMatchObject({ setupSql: "", checks: [], ordered: false, variants: [] });
    expect(sqlSpecSchema.safeParse({ referenceSql: "SELECT 1", variants: Array(5).fill({ name: "v", extraSql: "x" }) }).success).toBe(false);
  });
});

describe("classification des erreurs", () => {
  it("syntaxe, plantage, boucle infinie, sortie fausse, format, cas limite", () => {
    expect(classify([o({ status: "pass" })])).toEqual([]);
    expect(classify([o({ status: "error", reason: "syntax" })])[0]).toMatchObject({ category: "SYNTAX", kind: "syntax" });
    expect(classify([o({ status: "error", reason: "runtime" })])[0]).toMatchObject({ category: "LOGIC", kind: "runtime" });
    expect(classify([o({ status: "timeout", reason: "timeout" })])[0]).toMatchObject({ category: "LOGIC", kind: "timeout" });
    expect(classify([o({ status: "fail", reason: "wrong_output" })])[0]).toMatchObject({ category: "LOGIC", kind: "wrong_output" });
    expect(classify([o({ status: "fail", reason: "format" })])[0]).toMatchObject({ category: "INSTRUCTION", kind: "format" });
    expect(classify([o({ status: "error", reason: "missing_function" })])[0]).toMatchObject({ category: "INSTRUCTION" });
    expect(classify([o({ status: "pass" }), o({ status: "fail", reason: "wrong_output", edge: true, name: "liste vide" })])[0]).toMatchObject({ kind: "edge_case", tests: ["liste vide"] });
  });

  it("n'invente jamais CONCEPT ou METHOD à partir de simples tests", () => {
    const all = classify([o({ status: "fail", reason: "wrong_output" }), o({ status: "error", reason: "runtime" }), o({ status: "error", reason: "syntax" })]);
    expect(all.every((d) => d.category !== "CONCEPT" && d.category !== "METHOD")).toBe(true);
    expect(classify([o({ status: "not_run" })])).toEqual([]);
  });

  it("messages d'erreur SQL", () => {
    expect(sqlErrorReason('near "FORM": syntax error')).toBe("syntax");
    expect(sqlErrorReason("no such column: nom")).toBe("schema_name");
    expect(sqlErrorReason("UNIQUE constraint failed")).toBe("sql_error");
  });
});
