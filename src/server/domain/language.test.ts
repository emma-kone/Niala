import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language";
import { annotationInEnglish } from "@/server/reliability/annotations-en";

describe("détection de la langue d'un cours", () => {
  it("reconnaît un cours en anglais", () => {
    expect(detectLanguage("The relational model is based on the concept of a relation. Each table has a primary key and the rows of the table are tuples that can be joined with other tables.")).toBe("en");
  });
  it("reconnaît un cours en français", () => {
    expect(detectLanguage("Le modèle relationnel repose sur la notion de relation. Chaque table possède une clé primaire et les lignes de la table sont des n-uplets que l'on peut joindre avec d'autres tables.")).toBe("fr");
  });
  it("garde la langue par défaut pour un texte trop court", () => {
    expect(detectLanguage("Jointures SQL")).toBe("fr");
    expect(detectLanguage("Present perfect", "en")).toBe("en");
  });
});

describe("avertissements de fiabilité en anglais", () => {
  it("traduit les avertissements connus et donne un avertissement générique sinon", () => {
    expect(annotationInEnglish("Il s'agit d'une opinion, et non d'un fait établi.")).toBe("This is an opinion, not an established fact.");
    expect(annotationInEnglish("Cette information pourrait être obsolète (source de 2019).")).toContain("2019");
    expect(annotationInEnglish("Phrase inconnue")).toBe("Unverified: check the sources.");
  });
});
