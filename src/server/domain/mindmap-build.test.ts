import { describe, expect, it } from "vitest";
import { buildMindMap, rawMindMapSchema, MAX_DEPTH } from "./mindmap-build";

const SOURCE = "Une fonction est un bloc de code reutilisable. Les parametres permettent de transmettre des valeurs. La recursivite est une fonction qui s'appelle elle-meme.";
const raw = (nodes: object[], links: object[] = []) => rawMindMapSchema.parse({ title: "Les fonctions", nodes, links });

describe("construction d'une carte mentale", () => {
  it("garde un arbre cohérent et marque la provenance d'après le texte", () => {
    const m = buildMindMap(raw([
      { id: "r", label: "Fonctions", parent: null, kind: "theme" },
      { id: "a", label: "Fonction réutilisable", parent: "r", detail: "bloc de code reutilisable" },
      { id: "b", label: "Paramètres", parent: "r", detail: "transmettre des valeurs" },
      { id: "c", label: "Quantique relativiste", parent: "r", detail: "sans lien avec le cours" },
    ]), SOURCE, "Cours");
    expect(m.nodes.filter((n) => !n.parent)).toHaveLength(1);
    expect(m.nodes.find((n) => n.key === "a")?.origin).toBe("DOCUMENT");
    expect(m.nodes.find((n) => n.key === "c")?.origin).toBe("AI_INFERRED");
  });
  it("rattache les orphelins à la racine, brise les cycles et retire les doublons", () => {
    const m = buildMindMap(raw([
      { id: "r", label: "Racine", parent: null },
      { id: "a", label: "A", parent: "b" },
      { id: "b", label: "B", parent: "a" },
      { id: "c", label: "C", parent: "inconnu" },
      { id: "d", label: "C", parent: "r" },
      { id: "r", label: "Doublon d'identifiant", parent: null },
    ]), SOURCE, "Cours");
    const keys = new Set(m.nodes.map((n) => n.key));
    for (const n of m.nodes) if (n.parent) expect(keys.has(n.parent)).toBe(true);
    expect(m.nodes.filter((n) => !n.parent)).toHaveLength(1);
    expect(m.repairs).toBeGreaterThan(0);
    // aucun cycle : chaque nœud remonte à la racine
    for (const n of m.nodes) {
      let cur: string | null = n.key;
      for (let i = 0; i < 20 && cur; i++) cur = m.nodes.find((x) => x.key === cur)?.parent ?? null;
      expect(cur).toBeNull();
    }
  });
  it("crée une racine quand le modèle n'en propose pas, et borne la profondeur", () => {
    const chain = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, label: `Niveau ${i}`, parent: i === 0 ? "x" : `n${i - 1}` }));
    const m = buildMindMap(raw(chain), SOURCE, "Cours");
    expect(Math.max(...m.nodes.map((n) => n.depth))).toBeLessThanOrEqual(MAX_DEPTH);
  });
  it("filtre les liens transversaux invalides ou redondants", () => {
    const m = buildMindMap(raw([
      { id: "r", label: "Racine", parent: null },
      { id: "a", label: "A", parent: "r" },
      { id: "b", label: "B", parent: "r" },
    ], [
      { from: "a", to: "b", type: "PREREQUISITE" },
      { from: "a", to: "b", type: "PREREQUISITE" },
      { from: "a", to: "zzz", type: "RELATED" },
      { from: "a", to: "r", type: "RELATED" },
      { from: "a", to: "a", type: "RELATED" },
    ]), SOURCE, "Cours");
    expect(m.links).toEqual([{ from: "a", to: "b", type: "PREREQUISITE" }]);
  });
  it("refuse une réponse trop pauvre", () => {
    expect(rawMindMapSchema.safeParse({ title: "x", nodes: [{ id: "1", label: "seul" }] }).success).toBe(false);
  });
});
