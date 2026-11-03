import { describe, expect, it } from "vitest";
import { layoutLayers, layoutTree } from "./map-layout";
import { mapStateSchema } from "./map-validation";

const n = (id: string) => ({ id });
const part = (source: string, target: string) => ({ source, target, type: "PART_OF" });

describe("disposition en arbre", () => {
  it("place la racine à gauche et centre le parent sur ses enfants", () => {
    const nodes = ["root", "a", "b", "a1", "a2"].map(n);
    const pos = layoutTree(nodes, [part("a", "root"), part("b", "root"), part("a1", "a"), part("a2", "a")]);
    expect(pos.root.x).toBe(0);
    expect(pos.a.x).toBe(280);
    expect(pos.a1.x).toBe(560);
    expect(pos.a.y).toBe((pos.a1.y + pos.a2.y) / 2);
    expect(new Set(Object.values(pos).map((p) => `${p.x},${p.y}`)).size).toBe(5); // aucune superposition
  });
  it("résiste aux cycles et aux nœuds orphelins", () => {
    const pos = layoutTree(["x", "y", "z"].map(n), [part("x", "y"), part("y", "x")]);
    expect(Object.keys(pos).sort()).toEqual(["x", "y", "z"]);
  });
});

describe("disposition en couches", () => {
  it("range les prérequis à gauche et les notions isolées en grille", () => {
    const nodes = ["fonctions", "parametres", "callbacks", "seul1", "seul2"].map(n);
    const edges = [
      { source: "fonctions", target: "parametres", type: "PREREQUISITE" },
      { source: "parametres", target: "callbacks", type: "PREREQUISITE" },
    ];
    const pos = layoutLayers(nodes, edges);
    expect(pos.fonctions.x).toBeLessThan(pos.parametres.x);
    expect(pos.parametres.x).toBeLessThan(pos.callbacks.x);
    expect(pos.seul1.y).toBeGreaterThan(pos.fonctions.y);
    expect(pos.seul1).not.toEqual(pos.seul2);
  });
  it("ne boucle pas sur un cycle de prérequis", () => {
    const pos = layoutLayers(["a", "b"].map(n), [
      { source: "a", target: "b", type: "PREREQUISITE" },
      { source: "b", target: "a", type: "PREREQUISITE" },
    ]);
    expect(Object.keys(pos)).toHaveLength(2);
  });
});

describe("validation d'une carte", () => {
  const node = (id: string) => ({ id, label: "Notion", x: 0, y: 0, origin: "USER" as const });
  const base = { nodes: [node("node-0001"), node("node-0002")], edges: [] };
  it("accepte un état valide", () => {
    expect(mapStateSchema.safeParse({ ...base, edges: [{ id: "edge-0001", source: "node-0001", target: "node-0002", type: "RELATED", origin: "USER" }] }).success).toBe(true);
  });
  it("refuse boucle, doublon, nœud inexistant, libellé vide, identifiant invalide, coordonnées folles", () => {
    const edge = (o: object) => ({ id: "edge-0001", source: "node-0001", target: "node-0002", type: "RELATED", origin: "USER", ...o });
    expect(mapStateSchema.safeParse({ ...base, edges: [edge({ target: "node-0001" })] }).success).toBe(false);
    expect(mapStateSchema.safeParse({ ...base, edges: [edge({ target: "node-9999" })] }).success).toBe(false);
    expect(mapStateSchema.safeParse({ ...base, edges: [edge({}), edge({ id: "edge-0002" })] }).success).toBe(false);
    expect(mapStateSchema.safeParse({ nodes: [{ ...node("node-0001"), label: "  " }], edges: [] }).success).toBe(false);
    expect(mapStateSchema.safeParse({ nodes: [node("a b")], edges: [] }).success).toBe(false);
    expect(mapStateSchema.safeParse({ nodes: [{ ...node("node-0001"), x: 1e12 }], edges: [] }).success).toBe(false);
    expect(mapStateSchema.safeParse({ nodes: [node("node-0001"), node("node-0001")], edges: [] }).success).toBe(false);
  });
});
