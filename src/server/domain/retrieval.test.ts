import { describe, expect, it } from "vitest";
import { computeCoverage, dot, fuseRankings, lexicalScore, queryTerms, resolveCitations, type Citation } from "./retrieval";

describe("recherche", () => {
  it("termes de la question : sans mots vides ni accents", () => {
    expect(queryTerms("Peux-tu m'expliquer la notion de récursivité dans ce cours ?")).toEqual(["notion", "recursivite"]);
  });
  it("score lexical : plus de termes distincts = meilleur", () => {
    const t = queryTerms("récursivité pile d'appels");
    expect(lexicalScore("La récursivité utilise la pile d'appels.", t)).toBeGreaterThan(lexicalScore("La récursivité est un concept.", t));
    expect(lexicalScore("Rien à voir.", t)).toBe(0);
  });
  it("fusion : un passage bien classé par les deux signaux gagne", () => {
    const s = fuseRankings([["a", "b", "c"], ["b", "a", "d"]]);
    expect([...s.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id).slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(dot([1, 0], [0.6, 0.8])).toBeCloseTo(0.6);
  });
});

describe("couverture honnête", () => {
  it("signale les pages sans texte et ne se dit jamais complète", () => {
    const c = computeCoverage({ pageCount: 5, pages: [1, 1, 2, 4], embeddedPassages: 4, extractWarnings: [], extractStatus: "PARTIAL" });
    expect(c.emptyPages).toEqual([3, 5]);
    expect(c.complete).toBe(false);
    expect(c.warnings.join(" ")).toContain("2 page(s) sans texte");
  });
  it("complète seulement si toutes les pages ont du texte et que l'extraction est READY", () => {
    expect(computeCoverage({ pageCount: 2, pages: [1, 2], embeddedPassages: 2, extractWarnings: [], extractStatus: "READY" }).complete).toBe(true);
  });
  it("vecteurs manquants et document vide sont signalés", () => {
    expect(computeCoverage({ pageCount: null, pages: [null, null], embeddedPassages: 0, extractWarnings: [], extractStatus: "READY" }).warnings.join(" ")).toContain("sémantique");
    expect(computeCoverage({ pageCount: 3, pages: [], embeddedPassages: 0, extractWarnings: [], extractStatus: "UNSUPPORTED" }).warnings.join(" ")).toContain("Aucun texte");
  });
});

describe("citations", () => {
  const known = new Map<number, Citation>([[1, { n: 1, documentId: "d", documentName: "Cours", subjectId: null, versionId: "v", page: 4, section: null, quote: "q" }]]);
  it("garde les références réelles, retire les inventées", () => {
    const r = resolveCitations("Une fonction est réutilisable [1]. Autre fait [7] [1, 9].", known);
    expect(r.text).toBe("Une fonction est réutilisable [1]. Autre fait [1].");
    expect(r.citations.map((c) => c.n)).toEqual([1]);
  });
});
