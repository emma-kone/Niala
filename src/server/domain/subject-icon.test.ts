import { describe, expect, it } from "vitest";
import { isSubjectIconId, resolveSubjectIcon, suggestSubjectIcon } from "./subject-icon";

describe("icône d'une matière", () => {
  it.each([
    ["Java EE", "java"],
    ["Développement web et multimédia", "web"],
    ["Entrepreneuriat", "startup"],
    ["Gestion de projets", "project"],
    ["UML et Java", "diagram"],
    ["AGL avec la méthode AGILE", "agile"],
    ["Bases de données", "database"],
    ["Algorithmique avancée", "algorithm"],
    ["Mathématiques", "math"],
    ["Développement mobile avec Android", "mobile"],
    ["Intelligence artificielle", "ai"],
    ["Droit des affaires", "law"],
  ])("%s → %s", (name, icon) => {
    expect(suggestSubjectIcon(name)).toBe(icon);
  });

  it("travaille sur des mots entiers, pas sur des sous-chaînes", () => {
    expect(suggestSubjectIcon("JavaScript avancé")).toBe("javascript");
    expect(suggestSubjectIcon("Comptabilité générale")).toBe("accounting");
    expect(suggestSubjectIcon("Vue d'ensemble")).toBe("generic");
  });

  it("reconnaît les notations techniques", () => {
    expect(suggestSubjectIcon("Programmation C++")).toBe("cpp");
    expect(suggestSubjectIcon("Langage C")).toBe("c");
  });

  it("est insensible aux accents et à la casse", () => {
    expect(suggestSubjectIcon("GESTION DE PROJETS")).toBe("project");
    expect(suggestSubjectIcon("developpement web")).toBe("web");
  });

  it("retombe sur une icône générique", () => {
    expect(suggestSubjectIcon("Atelier du jeudi")).toBe("generic");
  });

  it("donne toujours le même résultat, et respecte l'icône enregistrée", () => {
    expect(suggestSubjectIcon("Java EE")).toBe(suggestSubjectIcon("Java EE"));
    expect(resolveSubjectIcon("math", "Java EE")).toBe("math");
    expect(resolveSubjectIcon(null, "Java EE")).toBe("java");
    expect(resolveSubjectIcon("inconnue", "Java EE")).toBe("java");
  });

  it("valide les identifiants", () => {
    expect(isSubjectIconId("java")).toBe(true);
    expect(isSubjectIconId("autre")).toBe(false);
  });
});
