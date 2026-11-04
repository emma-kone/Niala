import { describe, expect, it } from "vitest";
import { buildReport, UNDETERMINED_MESSAGE, validateInterpretation, type EngineInput } from "./engine";
import { analyzeSqlAttempt } from "./analyzers/sql";
import type { Diagnosis } from "@/server/domain/lab-tests";

const diag = (category: Diagnosis["category"], kind: Diagnosis["kind"], label: string, confidence = 0.85): Diagnosis => ({ category, kind, confidence, label, tests: [] });
const base = (o: Partial<EngineInput>): EngineInput => ({ activity: "CODE", language: "python", status: "fail", diagnoses: [], concepts: [{ name: "Conditions" }], ...o });

describe("moteur de diagnostic : scénarios", () => {
  it("1. syntaxe incorrecte : l'erreur est un fait, pas un doute sur la compréhension", () => {
    const r = buildReport(base({ diagnoses: [diag("SYNTAX", "syntax", "Erreur de syntaxe.", 0.98)], error: { type: "SyntaxError", message: "expected ':'", line: 3 } }));
    expect(r).toMatchObject({ state: "DETERMINED", primary: "SYNTAX", needsVerification: false, pedagogical: true, recommendedAction: "targeted_explanation" });
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(r.evidence.join(" ")).toContain("ligne 3");
  });

  it("2. code valide, résultat incorrect : erreur de logique prouvée par les tests", () => {
    const r = buildReport(base({ diagnoses: [diag("LOGIC", "wrong_output", "Résultat différent.")], tests: { passed: 1, total: 4, edgePassed: 0, edgeTotal: 1 } }));
    expect(r).toMatchObject({ primary: "LOGIC", severity: "high" });
    expect(r.evidence.join(" ")).toContain("1 test(s) réussi(s) sur 4");
  });

  it("3. solution alternative correcte : aucune erreur", () => {
    const r = buildReport(base({ status: "pass", tests: { passed: 4, total: 4, edgePassed: 1, edgeTotal: 1 } }));
    expect(r).toMatchObject({ state: "NONE", primary: null, severity: "none", needsVerification: false });
  });

  it("5. consigne mal comprise (format imposé non respecté)", () => {
    const r = buildReport(base({ diagnoses: [diag("INSTRUCTION", "format", "Présentation demandée non respectée.")] }));
    expect(r).toMatchObject({ primary: "INSTRUCTION", recommendedAction: "retry" });
  });

  it("6. erreur algorithmique : jamais déduite des tests seuls, mais traitée comme grave quand elle est fournie", () => {
    const r = buildReport(base({ diagnoses: [diag("ALGORITHM", "wrong_output", "Démarche incomplète.", 0.6), diag("LOGIC", "edge_case", "Cas limites oubliés.")] }));
    expect(r.primary).toBe("ALGORITHM");
    expect(r.secondary).toContain("LOGIC");
    expect(r.severity).toBe("high");
  });

  it("7. oubli isolé après des réussites : inattention POSSIBLE, marquée hypothèse à vérifier", () => {
    const r = buildReport(base({ diagnoses: [diag("LOGIC", "edge_case", "Cas limite oublié.")], history: { sameCategory: 0, priorSuccesses: 3, hintsUsed: 0 } }));
    expect(r.primary).toBe("LOGIC");
    expect(r.secondary).toContain("CARELESS");
    expect(r.needsVerification).toBe(true);
    expect(r.evidence.join(" ")).toContain("hypothèse");
  });

  it("7bis. pas d'inattention supposée sans réussites antérieures", () => {
    const r = buildReport(base({ diagnoses: [diag("LOGIC", "edge_case", "Cas limite oublié.")], history: { sameCategory: 0, priorSuccesses: 0, hintsUsed: 0 } }));
    expect(r.secondary).not.toContain("CARELESS");
  });

  it("8. erreur répétée : piste conceptuelle à vérifier, jamais affirmée", () => {
    const r = buildReport(base({ diagnoses: [diag("LOGIC", "wrong_output", "Résultat différent.")], history: { sameCategory: 3, priorSuccesses: 0, hintsUsed: 1 } }));
    expect(r).toMatchObject({ primary: "LOGIC", needsVerification: true, recommendedAction: "clarifying_question", severity: "high" });
    expect(r.evidence.join(" ")).toContain("3 tentative(s)");
    expect(r.evidence.join(" ")).toContain("possible");
  });

  it("9. difficulté venant d'un prérequis : seulement s'il est mesuré faible, et après une récidive", () => {
    const prerequisites = [
      { name: "Opérateurs de comparaison", level: 0.3, confidence: 0.6 },
      { name: "Variables", level: 0.9, confidence: 0.8 },
      { name: "Séquence", level: 0.2, confidence: 0.1 },
    ];
    const once = buildReport(base({ diagnoses: [diag("LOGIC", "wrong_output", "Résultat différent.")], prerequisites, history: { sameCategory: 0, priorSuccesses: 0, hintsUsed: 0 } }));
    expect(once.prerequisites.map((p) => p.name)).toEqual(["Opérateurs de comparaison"]);
    expect(once.recommendedAction).toBe("retry"); // rien n'est propagé après une seule erreur
    const twice = buildReport(base({ diagnoses: [diag("LOGIC", "wrong_output", "Résultat différent.")], prerequisites, history: { sameCategory: 2, priorSuccesses: 0, hintsUsed: 0 } }));
    expect(twice.recommendedAction).toBe("review_prerequisite");
  });

  it("13. erreur d'environnement : jamais une lacune de l'étudiant", () => {
    const r = buildReport(base({ status: "error", diagnoses: [diag("LOGIC", "runtime", "Le programme plante.")], error: { type: "ModuleNotFoundError", message: "No module named 'numpy'" } }));
    expect(r).toMatchObject({ primary: "ENVIRONMENT", pedagogical: false, recommendedAction: "check_environment" });
    const down = buildReport(base({ status: "unavailable" }));
    expect(down).toMatchObject({ primary: "ENVIRONMENT", pedagogical: false });
  });

  it("14. données insuffisantes : état incertain et demande de clarification, aucune cause inventée", () => {
    const r = buildReport(base({ status: "fail", diagnoses: [] }));
    expect(r).toMatchObject({ state: "UNCERTAIN", primary: null, summary: UNDETERMINED_MESSAGE, needsVerification: true, recommendedAction: "clarifying_question" });
    expect(r.confidence).toBeLessThan(0.3);
  });

  it("réussite avec beaucoup d'indices : à vérifier", () => {
    expect(buildReport(base({ status: "pass", history: { sameCategory: 0, priorSuccesses: 0, hintsUsed: 3 } }))).toMatchObject({ state: "NONE", needsVerification: true, recommendedAction: "verify_understanding" });
  });
});

describe("SQL : analyseur spécialisé", () => {
  it("11. requête valide mais mauvais résultat : comparaison à NULL détectée", () => {
    const d = analyzeSqlAttempt("SELECT nom FROM employes WHERE manager_id = NULL");
    expect(d.map((x) => x.kind)).toEqual(["sql_null_comparison"]);
    expect(analyzeSqlAttempt("SELECT nom FROM employes WHERE manager_id IS NULL")).toEqual([]);
    expect(analyzeSqlAttempt("SELECT 'a = NULL' AS t")).toEqual([]);
  });

  it("12. WHERE / HAVING : agrégat dans WHERE = confusion possible, jamais affirmée", () => {
    const d = analyzeSqlAttempt("SELECT client_id, COUNT(*) FROM commandes WHERE COUNT(*) > 3 GROUP BY client_id;", { message: "misuse of aggregate: COUNT()" });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ category: "CONCEPT", kind: "sql_where_having" });
    expect(d[0].confidence).toBeLessThan(0.8);
    expect(d[0].label).toContain("HAVING");
    const r = buildReport({ activity: "SQL", language: "sql", status: "error", diagnoses: d, error: { type: "SqliteError", message: "misuse of aggregate: COUNT()" }, concepts: [{ name: "WHERE et HAVING" }] });
    expect(r.primary).toBe("CONCEPT");
    expect(r.severity).toBe("high");
    expect(r.confidence).toBeLessThan(0.8);
  });
});

describe("garde-fou contre une interprétation IA défaillante", () => {
  const input = base({ diagnoses: [diag("SYNTAX", "syntax", "Erreur de syntaxe.", 0.98)] });
  const rep = buildReport(input);
  const ai = (o: Partial<Parameters<typeof validateInterpretation>[1]>) => ({ primary: "SYNTAX" as const, confidence: 0.6, summary: "x", evidence: [] as string[], ...o });

  it("refuse une confiance hors bornes", () => {
    expect(validateInterpretation(rep, ai({ confidence: 1.7 }), input)).toMatchObject({ ok: false });
  });
  it("refuse une catégorie qui contredit l'erreur de syntaxe établie par l'outil", () => {
    expect(validateInterpretation(rep, ai({ primary: "CONCEPT", confidence: 0.5 }), input)).toMatchObject({ ok: false });
  });
  it("refuse une erreur affirmée alors que tout est réussi", () => {
    const pass = base({ status: "pass" });
    expect(validateInterpretation(buildReport(pass), ai({ primary: "LOGIC" }), pass)).toMatchObject({ ok: false });
  });
  it("refuse une erreur d'environnement attribuée à l'étudiant", () => {
    const env = base({ status: "error", error: { type: "ModuleNotFoundError", message: "No module named 'x'" } });
    expect(validateInterpretation(buildReport(env), ai({ primary: "CONCEPT" }), env)).toMatchObject({ ok: false });
  });
  it("refuse une confiance élevée sur une hypothèse de compréhension sans preuves répétées", () => {
    const logic = base({ diagnoses: [diag("LOGIC", "wrong_output", "Résultat différent.")] });
    expect(validateInterpretation(buildReport(logic), ai({ primary: "CONCEPT", confidence: 0.9 }), logic)).toMatchObject({ ok: false });
    expect(validateInterpretation(buildReport(logic), ai({ primary: "CONCEPT", confidence: 0.5 }), logic)).toMatchObject({ ok: true });
  });
  it("refuse une preuve absente du dossier technique", () => {
    expect(validateInterpretation(rep, ai({ evidence: ["Le test 7 a échoué"] }), input)).toMatchObject({ ok: false });
    expect(validateInterpretation(rep, ai({ evidence: [rep.evidence[0]] }), input)).toMatchObject({ ok: true });
  });
});
