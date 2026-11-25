import { describe, expect, it } from "vitest";
import { appendBlocks, emptyNoteDoc, markdownToNoteBlocks, noteToText, parseNoteContent } from "./note-content";
import { isStructuralQuestion } from "./exercise-model";
import { repairQuote } from "@/server/ai/guard";
import { editOnlyLanguageOf, languageOf } from "./lab-tests";

describe("markdown → note", () => {
  it("produit des blocs valides pour l'éditeur", () => {
    const blocks = markdownToNoteBlocks("## Titre\n\nUn **mot** important et `code`.\n\n- un\n- deux\n\n1. a\n2. b\n\n> citation\n\n```js\nlet x = 1;\n```");
    const doc = parseNoteContent({ type: "doc", content: blocks });
    expect(doc.content.map((b) => b.type)).toEqual(["heading", "paragraph", "bulletList", "orderedList", "blockquote", "codeBlock"]);
    expect(noteToText(doc)).toContain("mot important");
  });

  it("s'ajoute à la suite d'une note existante sans toucher à son contenu", () => {
    const existing = parseNoteContent({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ma note" }] }] });
    const merged = appendBlocks(existing, markdownToNoteBlocks("Ajout de l'IA"));
    expect(noteToText(merged)).toBe("Ma note\nAjout de l'IA\n");
    expect(merged.content[0]).toEqual(existing.content[0]);
  });

  it("ne garde pas le paragraphe vide d'une note neuve", () => {
    const merged = appendBlocks(emptyNoteDoc(), markdownToNoteBlocks("Texte"));
    expect(merged.content).toHaveLength(1);
  });
});

describe("questions sur la structure du document", () => {
  it.each(["Quel est le titre de la section II.6 dans le plan détaillé du cours ?", "À quelle page se trouve la définition ?", "Combien de chapitres compte le document ?"])("écarte : %s", (q) => {
    expect(isStructuralQuestion(q)).toBe(true);
  });
  it.each(["Quelle est la définition d'un pointeur ?", "Quelle est la complexité du tri fusion ?", "Dans quel cas la page est-elle chargée en mémoire virtuelle ?"])("garde : %s", (q) => {
    expect(isStructuralQuestion(q)).toBe(false);
  });
});

describe("citation rattachée au passage réel", () => {
  const text = "Le tri fusion divise la liste en deux moitiés. Il trie chaque moitié récursivement puis fusionne les résultats. Sa complexité est en O(n log n) dans tous les cas.";
  it("retrouve la phrase d'une citation légèrement différente", () => {
    expect(repairQuote("le tri fusion divise la liste en 2 moitiés, trie chaque moitié récursivement", text)).toContain("trie chaque moitié récursivement");
  });
  it("refuse une citation sans rapport", () => {
    expect(repairQuote("Les protocoles réseau utilisent des paquets pour transmettre les données", text)).toBeNull();
  });
});

describe("langages du laboratoire", () => {
  it("C, C# et Java EE s'écrivent mais ne s'exécutent pas", () => {
    for (const l of ["c", "C#", "csharp", "java ee", "jakarta"]) {
      expect(languageOf(l)).toBeNull();
      expect(editOnlyLanguageOf(l)).not.toBeNull();
    }
    expect(languageOf("python")).toBe("python");
    expect(editOnlyLanguageOf("python")).toBeNull();
  });
});
