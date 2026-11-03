import { describe, expect, it } from "vitest";
import { annotationDoc, deriveKind, emptyNoteDoc, noteToText, parseNoteContent, snippet, NoteContentError } from "./note-content";

describe("contenu des notes", () => {
  it("accepte un document riche valide", () => {
    const doc = parseNoteContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Titre" }] },
        { type: "paragraph", content: [{ type: "text", text: "gras", marks: [{ type: "bold" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }] },
        { type: "codeBlock", attrs: { language: "python" }, content: [{ type: "text", text: "print(1)" }] },
        { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [{ type: "paragraph" }] }] }] },
      ],
    });
    expect(doc.content).toHaveLength(5);
    expect(noteToText(doc)).toContain("Titre");
  });

  it("refuse les nœuds inconnus, la mauvaise racine et les non-objets", () => {
    expect(() => parseNoteContent({ type: "doc", content: [{ type: "script" }] })).toThrow(NoteContentError);
    expect(() => parseNoteContent({ type: "paragraph" })).toThrow(NoteContentError);
    expect(() => parseNoteContent("<b>x</b>")).toThrow(NoteContentError);
    expect(() => parseNoteContent(null)).toThrow(NoteContentError);
  });

  it("neutralise les liens dangereux et les attributs inattendus", () => {
    const doc = parseNoteContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { onclick: "alert(1)" },
          content: [
            { type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: "y", marks: [{ type: "link", attrs: { href: "https://exemple.fr/a" } }, { type: "inconnue" }] },
          ],
        },
        { type: "heading", attrs: { level: 99 }, content: [] },
      ],
    });
    const [p, h] = doc.content;
    expect(p.attrs).toBeUndefined();
    expect(p.content![0].marks).toBeUndefined();
    expect(p.content![1].marks).toEqual([{ type: "link", attrs: { href: "https://exemple.fr/a", target: "_blank", rel: "noopener noreferrer nofollow" } }]);
    expect(h.attrs).toEqual({ level: 2 });
  });

  it("borne la taille et la profondeur", () => {
    let deep: unknown = { type: "paragraph" };
    for (let i = 0; i < 40; i++) deep = { type: "blockquote", content: [deep] };
    expect(() => parseNoteContent({ type: "doc", content: [deep] })).toThrow(/profond/);
    const big = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(500_000) }] }] };
    expect(() => parseNoteContent(big)).toThrow(/volumineuse/);
  });

  it("construit une annotation avec la citation et un paragraphe de commentaire", () => {
    const doc = annotationDoc("Une fonction récursive");
    expect(noteToText(doc).trim()).toBe("Une fonction récursive");
    expect(doc.content[1].type).toBe("paragraph");
    expect(snippet(doc)).toBe("Une fonction récursive");
    expect(parseNoteContent(emptyNoteDoc()).content).toHaveLength(1);
  });

  it("déduit la nature de la note depuis ses liens", () => {
    expect(deriveKind("PERSONAL", [])).toBe("PERSONAL");
    expect(deriveKind("PERSONAL", [{ anchor: null }])).toBe("DOCUMENT");
    expect(deriveKind("DOCUMENT", [{ anchor: null }, { anchor: { quote: "x" } }])).toBe("ANNOTATION");
    expect(deriveKind("DOCUMENT", [])).toBe("PERSONAL");
    expect(deriveKind("SUMMARY", [{ anchor: { quote: "x" } }])).toBe("SUMMARY");
  });
});
