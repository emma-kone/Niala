import { describe, expect, it } from "vitest";
import { describeDiagram, diagramWarnings, extractProposal, mcdToMld, mldText, parseDiagram, sanitizeDiagram, starterDiagram, type Diagram } from "./diagram";

const node = (id: string, type: "entity" | "association" | "class" | "note", name: string, attributes: { name: string; key?: boolean }[] = []) => ({ id, type, name, x: 0, y: 0, attributes, methods: [] });

describe("diagrammes : cohérence et notation", () => {
  it("retire les liens orphelins, les doublons et les pattes MCD invalides", () => {
    const d: Diagram = {
      kind: "mcd",
      nodes: [node("e1", "entity", "A", [{ name: "id", key: true }]), node("e2", "entity", "B", [{ name: "id", key: true }]), node("a1", "association", "R"), node("n1", "note", "note")],
      links: [
        { id: "l1", from: "e1", to: "a1", type: "mcd", cardFrom: "1,1" },
        { id: "l1", from: "e2", to: "a1", type: "mcd" },
        { id: "l2", from: "e1", to: "e2", type: "mcd" },
        { id: "l3", from: "e1", to: "zz", type: "mcd" },
        { id: "l4", from: "n1", to: "a1", type: "mcd" },
      ],
    };
    expect(sanitizeDiagram(d).links.map((l) => l.id)).toEqual(["l1"]);
  });

  it("signale identifiant manquant, cardinalité absente et association à une seule patte", () => {
    const w = diagramWarnings({ kind: "mcd", nodes: [node("e1", "entity", "CLIENT"), node("a1", "association", "PASSER")], links: [{ id: "l1", from: "e1", to: "a1", type: "mcd" }] }).join(" | ");
    expect(w).toContain("« CLIENT » n'a pas d'identifiant");
    expect(w).toContain("doit relier au moins deux pattes");
    expect(w).toContain("n'a pas de cardinalité");
  });

  it("passe du MCD au MLD : clé étrangère côté (x,1), table pour (n,n)", () => {
    const d: Diagram = {
      kind: "mcd",
      nodes: [
        node("c", "entity", "CLIENT", [{ name: "numClient", key: true }]),
        node("o", "entity", "COMMANDE", [{ name: "numCde", key: true }]),
        node("p", "entity", "PRODUIT", [{ name: "ref", key: true }]),
        node("a1", "association", "PASSER"),
        node("a2", "association", "CONTENIR", [{ name: "quantite" }]),
      ],
      links: [
        { id: "1", from: "c", to: "a1", type: "mcd", cardFrom: "0,n" },
        { id: "2", from: "o", to: "a1", type: "mcd", cardFrom: "1,1" },
        { id: "3", from: "o", to: "a2", type: "mcd", cardFrom: "1,n" },
        { id: "4", from: "p", to: "a2", type: "mcd", cardFrom: "0,n" },
      ],
    };
    const txt = mldText(mcdToMld(d));
    expect(txt).toContain("COMMANDE (_numCde_, #numClient)");
    expect(txt).toContain("CONTENIR (_#numCde_, _#ref_, quantite)");
    expect(txt).not.toContain("PASSER");
  });

  it("lit un contenu illisible comme un diagramme vide et décrit le diagramme pour l'IA", () => {
    expect(parseDiagram("{oops", "uml")).toEqual({ kind: "uml", nodes: [], links: [] });
    const desc = describeDiagram(starterDiagram("uml"));
    expect(desc).toContain("Classe [c1] Personne «abstract»");
    expect(desc).toContain("Héritage [l1] Étudiant → Personne");
  });

  it("extrait la proposition de l'assistant et place les nouveaux éléments", () => {
    const current = starterDiagram("mcd");
    const withoutPos = current.nodes.map((n) => ({ id: n.id, type: n.type, name: n.name, attributes: n.attributes }));
    const p = { nodes: [...withoutPos, { id: "e9", type: "entity", name: "SALLE", attributes: [{ name: "num", key: true }] }], links: current.links };
    const r = extractProposal("Voici.\n```niala-diagram\n" + JSON.stringify(p) + "\n```", current);
    expect(r.text).toBe("Voici.");
    expect(r.proposal?.nodes.find((n) => n.id === "e1")).toMatchObject({ x: 60, y: 80 });
    expect(r.proposal?.nodes.find((n) => n.id === "e9")?.x).toBeGreaterThan(0);
    expect(extractProposal("```niala-diagram\n{faux\n```", current)).toMatchObject({ proposal: null, invalid: true });
    expect(extractProposal("Juste une explication.", current)).toMatchObject({ text: "Juste une explication.", proposal: null, invalid: false });
  });
});
