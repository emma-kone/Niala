import { describe, expect, it } from "vitest";
import { detectDocumentKind } from "./exercise-source";

describe("detectDocumentKind", () => {
  it("reconnaît un sujet d'exercices numérotés", () => {
    const text = "Exercice 1\nCalculer la dérivée de f.\nExercice 2\nMontrer que la suite converge.\nDéterminer la limite.";
    expect(detectDocumentKind("analyse.pdf", text)).toBe("sheet");
  });
  it("s'appuie sur le nom du fichier avec le ton impératif", () => {
    expect(detectDocumentKind("TD3 - Algèbre.pdf", "Soit E un espace vectoriel. Montrer que F est un sous-espace. Déterminer sa dimension. Justifier.")).toBe("sheet");
  });
  it("traite un cours comme un cours", () => {
    const text = "Chapitre 1. Les bases de données relationnelles\nUne base de données est un ensemble organisé de données. ".repeat(40);
    expect(detectDocumentKind("cours-bdd.pdf", text)).toBe("course");
  });
  it("traite un document sans texte comme un cours", () => {
    expect(detectDocumentKind("scan.pdf", "")).toBe("course");
  });
});
