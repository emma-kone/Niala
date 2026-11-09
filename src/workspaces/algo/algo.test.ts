import { describe, expect, it } from "vitest";
import { lintAlgo, lintBrackets, lintPseudo } from "./logic";
import { emptyAlgo, readAlgo } from "./model";

const messages = (code: string) => lintPseudo(code).filter((i) => i.level !== "info").map((i) => `${i.line}:${i.message}`);

describe("pseudo-code", () => {
  const GOOD = `Algorithme Somme
Variables
  n, i, s : entier
Début
  Lire(n)
  s ← 0
  Pour i de 1 à n Faire
    Si i mod 2 = 0 Alors
      s ← s + i
    FinSi
  FinPour
  Écrire(s)
Fin`;
  it("accepte un algorithme bien formé", () => {
    expect(messages(GOOD)).toEqual([]);
  });
  it("signale un bloc non fermé avec sa ligne d'ouverture", () => {
    const m = messages(GOOD.replace("    FinSi\n", ""));
    expect(m.join("|")).toMatch(/« Si » .* n'est pas fermé|FinPour|ne correspond pas/);
  });
  it("signale un mauvais mot de fermeture, les « Alors/Faire » oubliés et « = » en affectation", () => {
    const m = messages(`Algorithme A
Variables x : entier
Début
  x = 5
  Si x > 3
    x ← 1
  FinPour
Fin`).join("|");
    expect(m).toContain("« ← »");
    expect(m).toContain("« Alors »");
    expect(m).toContain("ne correspond pas au bloc « Si »");
  });
  it("repère les variables non déclarées et celles jamais utilisées", () => {
    const issues = lintPseudo(`Algorithme B
Variables a, b : entier
Début
  c ← 1
  a ← 2
Fin`);
    expect(issues.some((i) => i.message.includes("« c »") && i.level === "warning")).toBe(true);
    expect(issues.some((i) => i.message.includes("« b »") && i.level === "info")).toBe(true);
  });
  it("gère Répéter…Jusqu'à et Tant que", () => {
    expect(messages(`Algorithme C
Variables n : entier
Début
  n ← 0
  Répéter
    n ← n + 1
  Jusqu'à n = 3
  Tant que n > 0 Faire
    n ← n - 1
  FinTantQue
Fin`)).toEqual([]);
  });
  it("ne dit rien d'un éditeur vide", () => {
    expect(lintPseudo("  \n")).toEqual([]);
  });
});

describe("autres langages", () => {
  it("détecte parenthèses et chaînes non fermées", () => {
    expect(lintBrackets("print((1 + 2)")).toHaveLength(1);
    expect(lintBrackets('print("abc)')[0].message).toContain("Chaîne");
    expect(lintBrackets("def f(a):\n  return [a, (1)]")).toEqual([]);
    expect(lintAlgo("}", "javascript")).toHaveLength(1);
  });
  it("lit une production abîmée sans erreur", () => {
    expect(readAlgo(null)).toEqual(emptyAlgo());
    expect(readAlgo({ language: "klingon" }, "python").language).toBe("python");
  });
});
