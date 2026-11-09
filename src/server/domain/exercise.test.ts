import { describe, expect, it } from "vitest";
import { allocatePoints, buildQuestion, buildSlots, exerciseConfigSchema, rawQuestionSchema, semanticProblem, DIFFICULTY_WEIGHT } from "./exercise-model";
import { gradeKeywords, gradeObjective, normalizeAnswer } from "./exercise-grading";

const sum = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

describe("répartition théorie / pratique", () => {
  const practice = (slots: { type: string }[]) => slots.filter((s) => s.type === "code").length;
  const types = ["qcm_single", "code"] as const;

  it("respecte le pourcentage demandé", () => {
    expect(practice(buildSlots(10, [...types], "moyenne", 90))).toBe(9);
    expect(practice(buildSlots(10, [...types], "moyenne", 10))).toBe(1);
    expect(practice(buildSlots(10, [...types], "moyenne", 0))).toBe(0);
    expect(practice(buildSlots(10, [...types], "moyenne", 100))).toBe(10);
  });

  it("répartit les questions pratiques régulièrement dans l'exercice", () => {
    const seq = buildSlots(10, [...types], "moyenne", 50).map((s) => s.type);
    expect(seq.slice(0, 5).filter((t) => t === "code")).toHaveLength(2 + (seq[4] === "code" ? 1 : 0));
    expect(seq.filter((t) => t === "code")).toHaveLength(5);
  });

  it("sans type théorique, tout est pratique ; sans pourcentage, les types alternent", () => {
    expect(practice(buildSlots(4, ["code"], "moyenne", 30))).toBe(4);
    expect(buildSlots(4, [...types], "moyenne").map((s) => s.type)).toEqual(["qcm_single", "code", "qcm_single", "code"]);
  });
});

describe("barème exact", () => {
  it("la somme des points égale toujours le barème demandé", () => {
    for (const [total, n] of [[10, 3], [20, 7], [100, 13], [7.5, 6], [20, 40], [1, 4]] as const) {
      const pts = allocatePoints(total, Array.from({ length: n }, (_, i) => 1 + (i % 3) * 0.5));
      expect(sum(pts)).toBe(total);
      expect(pts.every((p) => p >= 0.25)).toBe(true);
      expect(pts.every((p) => Math.abs(p / 0.25 - Math.round(p / 0.25)) < 1e-9)).toBe(true);
    }
  });
  it("donne plus de points aux questions difficiles", () => {
    const pts = allocatePoints(20, [DIFFICULTY_WEIGHT.facile, DIFFICULTY_WEIGHT.difficile]);
    expect(pts[1]).toBeGreaterThan(pts[0]);
    expect(sum(pts)).toBe(20);
  });
  it("refuse un barème trop petit", () => {
    expect(() => allocatePoints(1, [1, 1, 1, 1, 1])).toThrow();
  });
});

describe("configuration", () => {
  const base = { documentId: "doc1", questionCount: 10, totalPoints: 20, types: ["qcm_single"], coverage: { mode: "all" }, difficulty: "moyenne" };
  it("accepte les barèmes 10, 20, 100 et personnalisé ≤ 100", () => {
    for (const t of [10, 20, 100, 13.5]) expect(exerciseConfigSchema.safeParse({ ...base, totalPoints: t }).success).toBe(true);
  });
  it("refuse : barème > 100, pas multiple de 0,25, trop petit, trop de questions, couverture vide", () => {
    expect(exerciseConfigSchema.safeParse({ ...base, totalPoints: 101 }).success).toBe(false);
    expect(exerciseConfigSchema.safeParse({ ...base, totalPoints: 10.1 }).success).toBe(false);
    expect(exerciseConfigSchema.safeParse({ ...base, questionCount: 30, totalPoints: 5 }).success).toBe(false);
    expect(exerciseConfigSchema.safeParse({ ...base, questionCount: 500, totalPoints: 100 }).success).toBe(false);
    expect(exerciseConfigSchema.safeParse({ ...base, coverage: { mode: "sections" } }).success).toBe(false);
    expect(exerciseConfigSchema.safeParse({ ...base, types: [] }).success).toBe(false);
  });
});

describe("créneaux", () => {
  it("n'utilise que les types choisis et les répartit", () => {
    const slots = buildSlots(7, ["qcm_single", "open"], "melangee");
    expect(new Set(slots.map((s) => s.type))).toEqual(new Set(["qcm_single", "open"]));
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it("difficulté progressive croissante, fixe sinon", () => {
    const prog = buildSlots(6, ["qcm_single"], "progressive").map((s) => s.difficulty);
    expect(prog).toEqual(["facile", "facile", "moyenne", "moyenne", "difficile", "difficile"]);
    expect(new Set(buildSlots(5, ["open"], "difficile").map((s) => s.difficulty))).toEqual(new Set(["difficile"]));
  });
});

describe("validation des questions générées", () => {
  const src = { source: { quote: "Une fonction est un bloc de code réutilisable" }, statement: "Qu'est-ce qu'une fonction ?", slot: 1 };
  it("accepte une question bien formée et refuse un type inconnu ou un QCM sans options", () => {
    expect(rawQuestionSchema.safeParse({ ...src, type: "qcm_single", options: ["a1", "b1", "c1"], correctIndex: 0 }).success).toBe(true);
    expect(rawQuestionSchema.safeParse({ ...src, type: "inconnu" }).success).toBe(false);
    expect(rawQuestionSchema.safeParse({ ...src, type: "qcm_single", options: ["a"], correctIndex: 0 }).success).toBe(false);
    expect(rawQuestionSchema.safeParse({ ...src, source: { quote: "court" }, type: "true_false", answer: true }).success).toBe(false);
  });
  it("détecte les incohérences sémantiques", () => {
    const q = (o: object) => rawQuestionSchema.parse({ ...src, ...o });
    expect(semanticProblem(q({ type: "qcm_single", options: ["a1", "b1", "c1"], correctIndex: 5 }))).toBeTruthy();
    expect(semanticProblem(q({ type: "qcm_multiple", options: ["a1", "b1", "c1", "d1"], correctIndexes: [0, 1, 2, 3] }))).toBeTruthy();
    expect(semanticProblem(q({ type: "fill_blank", statement: "Une ___ est un ___ de code", blanks: [{ accepted: ["fonction"] }] }))).toBeTruthy();
    expect(semanticProblem(q({ type: "fill_blank", statement: "Une ___ est un bloc de code", blanks: [{ accepted: ["fonction"] }] }))).toBeNull();
  });
});

describe("construction et correction objective", () => {
  const src = { source: { quote: "Une fonction est un bloc de code réutilisable" }, slot: 1 };
  const build = (o: object) => buildQuestion(rawQuestionSchema.parse({ ...src, statement: "Énoncé de la question ?", ...o }));

  it("ne divulgue pas la réponse dans la charge utile", () => {
    const b = build({ type: "qcm_single", options: ["bonne", "fausse 1", "fausse 2"], correctIndex: 0 });
    expect(JSON.stringify(b.payload)).not.toContain("correct");
    const opts = (b.payload.options as { id: string; label: string }[]);
    expect(opts.find((o) => o.label === "bonne")!.id).toBe((b.answerKey.correct as string[])[0]);
  });

  it("QCM unique et multiple, avec crédit partiel et pénalité", () => {
    const s = build({ type: "qcm_single", options: ["a1", "b1", "c1"], correctIndex: 1 });
    const right = (s.answerKey.correct as string[])[0];
    expect(gradeObjective("qcm_single", s.answerKey, right, 2)).toMatchObject({ verdict: "correct", points: 2 });
    expect(gradeObjective("qcm_single", s.answerKey, "faux", 2)).toMatchObject({ verdict: "incorrect", points: 0 });
    expect(gradeObjective("qcm_single", s.answerKey, null, 2)).toMatchObject({ verdict: "skipped", points: 0 });

    const m = build({ type: "qcm_multiple", options: ["a1", "b1", "c1", "d1"], correctIndexes: [0, 1] });
    const [c1, c2] = m.answerKey.correct as string[];
    const wrong = (m.payload.options as { id: string }[]).find((o) => !(m.answerKey.correct as string[]).includes(o.id))!.id;
    expect(gradeObjective("qcm_multiple", m.answerKey, [c1, c2], 4)).toMatchObject({ verdict: "correct", points: 4 });
    expect(gradeObjective("qcm_multiple", m.answerKey, [c1], 4)).toMatchObject({ verdict: "partial", points: 2 });
    expect(gradeObjective("qcm_multiple", m.answerKey, [c1, wrong], 4)).toMatchObject({ verdict: "incorrect", points: 0 });
  });

  it("vrai/faux, réponse courte tolérante, trous avec et sans propositions", () => {
    expect(gradeObjective("true_false", { answer: true }, true, 1)!.verdict).toBe("correct");
    expect(gradeObjective("true_false", { answer: true }, false, 1)!.verdict).toBe("incorrect");
    expect(gradeObjective("short_answer", { accepted: ["Le polymorphisme", "polymorphisme"] }, "  POLYMORPHISME ", 1)!.verdict).toBe("correct");
    expect(gradeObjective("short_answer", { accepted: ["3.5"] }, "3,5", 1)!.verdict).toBe("correct");

    const f = build({ type: "fill_blank", statement: "Une ___ appelle une autre ___ elle-même.", blanks: [{ accepted: ["fonction", "function"] }, { accepted: ["fonction"] }] });
    const [b1, b2] = Object.keys(f.answerKey.answers as object);
    expect(gradeObjective("fill_blank", f.answerKey, { [b1]: "Fonction", [b2]: "méthode" }, 2)).toMatchObject({ verdict: "partial", points: 1 });
    expect(gradeObjective("fill_blank", f.answerKey, { [b1]: "function", [b2]: "la fonction" }, 2)).toMatchObject({ verdict: "correct", points: 2 });

    const c = build({ type: "fill_choices", statement: "Une ___ est un bloc.", blanks: [{ options: ["fonction", "variable", "boucle"], correctIndex: 0 }] });
    const [bid] = Object.keys(c.answerKey.answers as object);
    expect(gradeObjective("fill_choices", c.answerKey, { [bid]: "fonction" }, 1)!.verdict).toBe("correct");
    expect(gradeObjective("fill_choices", c.answerKey, { [bid]: "boucle" }, 1)!.verdict).toBe("incorrect");
  });

  it("association : crédit partiel par paire", () => {
    const m = build({ type: "matching", pairs: [{ left: "HTTP", right: "Web" }, { left: "SMTP", right: "Courrier" }, { left: "DNS", right: "Noms" }] });
    const key = m.answerKey.pairs as Record<string, string>;
    const [l1, l2, l3] = Object.keys(key);
    expect(gradeObjective("matching", m.answerKey, key, 3)).toMatchObject({ verdict: "correct", points: 3 });
    expect(gradeObjective("matching", m.answerKey, { [l1]: key[l1], [l2]: key[l3], [l3]: key[l2] }, 3)).toMatchObject({ verdict: "partial", points: 1 });
  });

  it("repli par mots-clés pour une définition, signalé comme tel", () => {
    const key = { reference: "Une fonction est un bloc de code réutilisable appelé par son nom.", keyPoints: ["bloc de code réutilisable", "appelé par son nom"] };
    const g = gradeKeywords(key, "C'est un bloc de code réutilisable que l'on appelle", 2);
    expect(g.method).toBe("keywords");
    expect(g.verdict).toBe("partial");
    expect(gradeKeywords(key, "", 2).verdict).toBe("skipped");
  });

  it("les types ouverts ne sont pas corrigés par les règles", () => {
    expect(gradeObjective("open", { reference: "x" }, "une réponse", 2)).toBeNull();
    expect(normalizeAnswer("L'Héritage")).toBe("heritage");
  });
});
