import { describe, expect, it } from "vitest";
import { parseStructure, romanToInt, sectionTexts } from "./structure-parser";

const COURSE = `CHAPITRE II : LES FONCTIONS
I. Introduction aux fonctions
Une fonction est un bloc de code réutilisable.
II. Déclaration des fonctions
A. Déclaration classique
B. Expression de fonction
C. Fonctions fléchées
III. Les paramètres
A. Paramètres obligatoires
B. Paramètres par défaut
C. Paramètres rest
IV. Les valeurs de retour
V. Les fonctions avancées
A. Fonctions récursives
1. Cas de base
2. Cas récursif
B. Fonctions de rappel
CHAPITRE III : LES OBJETS
I. Création d'objets`;

const outline = (text: string) =>
  parseStructure([{ page: 1, text }]).headings.map((h) => `${"  ".repeat(h.level)}${h.numbering} ${h.label}`);

describe("parseStructure", () => {
  it("reconstruit la hiérarchie CHAPITRE > I > A > 1 du cours d'exemple", () => {
    expect(outline(COURSE)).toEqual([
      "CHAPITRE II : LES FONCTIONS".replace("CHAPITRE II : ", "II ") ,
      "  I Introduction aux fonctions",
      "  II Déclaration des fonctions",
      "    A Déclaration classique",
      "    B Expression de fonction",
      "    C Fonctions fléchées",
      "  III Les paramètres",
      "    A Paramètres obligatoires",
      "    B Paramètres par défaut",
      "    C Paramètres rest",
      "  IV Les valeurs de retour",
      "  V Les fonctions avancées",
      "    A Fonctions récursives",
      "      1 Cas de base",
      "      2 Cas récursif",
      "    B Fonctions de rappel",
      "III LES OBJETS",
      "  I Création d'objets",
    ].map((l) => l.replace("II LES FONCTIONS", "II LES FONCTIONS")));
  });

  it("renvoie les parents corrects et la page d'origine", () => {
    const { headings } = parseStructure([
      { page: 3, text: "CHAPITRE I : BASES\nI. Premier point\nA. Détail" },
      { page: 4, text: "II. Second point" },
    ]);
    expect(headings.map((h) => h.parentIndex)).toEqual([null, 0, 1, 0]);
    expect(headings.map((h) => h.page)).toEqual([3, 3, 3, 4]);
    expect(headings[0].line).toBe("CHAPITRE I : BASES");
  });

  it("distingue le « I » romain de la lettre « I » dans une suite de lettres", () => {
    const text = ["CHAPITRE I : Bases", "I. Un premier point", ..."ABCDEFGHIJ".split("").map((c) => c + ". Sous-point " + c)].join("\n");
    const out = outline(text);
    expect(out).toContain("    I Sous-point I");
    expect(out.filter((l) => l.startsWith("  I "))).toHaveLength(1);
    expect(out.at(-1)).toBe("    J Sous-point J");
  });

  it("gère les numérotations décimales, ordinales et minuscules", () => {
    const out = outline("1. Réseaux\n1.1 Modèle OSI\n1.2 Modèle TCP/IP\n2. Routage\n1° Statique\n2° Dynamique\na) premier\nb) second");
    expect(out.slice(0, 4)).toEqual(["1 Réseaux", "  1.1 Modèle OSI", "  1.2 Modèle TCP/IP", "2 Routage"]);
    expect(out).toContain("  1° Statique");
  });

  it("rejette les numéros hors séquence (listes, références) et les phrases", () => {
    const text = "I. Introduction\nII. Suite\n7. Un élément isolé qui ne suit rien\nIII. Fin\n1. cela est une phrase de texte courant qui continue longuement et se termine par un point.";
    const r = parseStructure([{ page: 1, text }]);
    expect(r.headings.map((h) => h.numbering)).toEqual(["I", "II", "III"]);
    expect(r.rejected).toBeGreaterThanOrEqual(1);
  });

  it("gère les titres Markdown", () => {
    const out = outline("# Cours\n## Partie A\ntexte\n### Détail\n## Partie B");
    expect(out).toEqual(["# Cours", "  ## Partie A", "    ### Détail", "  ## Partie B"]);
  });

  it("ne détecte rien (et ne devine pas) sans numérotation fiable", () => {
    expect(parseStructure([{ page: 1, text: "Un texte sans titres.\nDeuxième ligne.\nTroisième ligne." }]).headings).toEqual([]);
    expect(parseStructure([{ page: 1, text: "I. Seul" }]).headings).toEqual([]);
  });

  it("convertit les chiffres romains", () => {
    expect(["I", "IV", "IX", "XIV", "XL", "MCMXC"].map(romanToInt)).toEqual([1, 4, 9, 14, 40, 1990]);
    expect(romanToInt("IIII")).toBeNull();
    expect(romanToInt("ABC")).toBeNull();
  });

  it("rattache le texte de chaque section et ses pages", () => {
    const pages = [
      { page: 1, text: "I. Alpha\ntexte alpha\nII. Beta" },
      { page: 2, text: "suite beta\nIII. Gamma\ntexte gamma" },
    ];
    const { headings } = parseStructure(pages);
    const t = sectionTexts(pages, headings);
    expect(t[0]).toMatchObject({ pageStart: 1, pageEnd: 1 });
    expect(t[0].text).toContain("texte alpha");
    expect(t[1]).toMatchObject({ pageStart: 1, pageEnd: 2 });
    expect(t[1].text).toContain("suite beta");
    expect(t[2].text).toContain("texte gamma");
  });
});
