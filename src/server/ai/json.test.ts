// Lecture tolérante des réponses de modèle : les défauts réels (« JSON illisible » dans le journal IA) doivent être
// réparés sans nouvel appel, et une réponse coupée ramenée à sa partie complète.
import { describe, expect, it } from "vitest";
import { parseJsonDetailed, parseJsonLoose, repairJson } from "./json";

describe("lecture tolérante du JSON", () => {
  it("lit un JSON valide, entouré de texte ou d'un bloc de code, sans le signaler comme réparé", () => {
    expect(parseJsonDetailed('Voici :\n```json\n{"a": [1, 2]}\n```')).toEqual({ value: { a: [1, 2] }, repaired: false, truncated: false });
    expect(parseJsonLoose("pas de json")).toBeNull();
  });

  it("répare les barres obliques inverses non doublées (formules, expressions régulières)", () => {
    const raw = '{"statement": "Calculer \\( \\sqrt{x^2} \\) pour x \\in R", "regex": "\\d+", "ok": "a\\nb \\"c\\" \\u00e9"}';
    expect(() => JSON.parse(raw)).toThrow(); // c'est bien le cas qui donnait « JSON illisible »
    const out = parseJsonDetailed<{ statement: string; regex: string; ok: string }>(raw);
    expect(out?.repaired).toBe(true);
    expect(out?.truncated).toBe(false);
    expect(out?.value.statement).toBe("Calculer \\( \\sqrt{x^2} \\) pour x \\in R");
    expect(out?.value.regex).toBe("\\d+");
    expect(out?.value.ok).toBe('a\nb "c" é'); // les échappements valides ne sont pas touchés
  });

  it("répare un saut de ligne brut dans une chaîne et une virgule finale", () => {
    const out = parseJsonDetailed<{ code: string; list: number[] }>('{"code": "ligne 1\nligne 2\tfin", "list": [1, 2, ], }');
    expect(out?.value).toEqual({ code: "ligne 1\nligne 2\tfin", list: [1, 2] });
    expect(out?.repaired).toBe(true);
  });

  it("ramène une réponse coupée à son dernier élément complet", () => {
    const raw = '{"questions": [{"slot": 1, "statement": "Un"}, {"slot": 2, "statement": "Deux"}, {"slot": 3, "statem';
    const out = parseJsonDetailed<{ questions: { slot: number }[] }>(raw);
    expect(out?.truncated).toBe(true);
    expect(out?.value.questions.map((q) => q.slot)).toEqual([1, 2]);
    // Coupure au milieu d'une valeur de premier niveau : les propriétés complètes sont gardées.
    expect(parseJsonDetailed('{"a": 1, "b": "inach')?.value).toEqual({ a: 1 });
    expect(parseJsonDetailed('{"a": {"b": [1, 2')?.value).toEqual({ a: { b: [1] } });
  });

  it("refuse une structure incohérente plutôt que de l'inventer", () => {
    expect(repairJson('{"a": [1, 2}')).toBeNull();
    expect(repairJson("aucune structure")).toBeNull();
  });
});
