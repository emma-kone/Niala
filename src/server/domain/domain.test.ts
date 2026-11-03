import { describe, expect, it } from "vitest";
import { canMoveFolder, descendantIds, nameKey, pathTo, uniqueName, validateFolderName, MAX_FOLDER_DEPTH } from "./folder-tree";
import { detectKind, matchesSignature, sanitizeName } from "./file-validation";
import { chunkPages, splitPages } from "./chunking";

const tree = [
  { id: "a", parentId: null, name: "A" },
  { id: "b", parentId: "a", name: "B" },
  { id: "c", parentId: "b", name: "C" },
  { id: "d", parentId: null, name: "D" },
];

describe("arborescence", () => {
  it("liste les descendants et le chemin", () => {
    expect(descendantIds(tree, "a").sort()).toEqual(["b", "c"]);
    expect(pathTo(tree, "c").map((f) => f.id)).toEqual(["a", "b", "c"]);
  });
  it("refuse les cycles et les déplacements dans soi-même", () => {
    expect(canMoveFolder(tree, "a", "c").ok).toBe(false);
    expect(canMoveFolder(tree, "a", "a").ok).toBe(false);
    expect(canMoveFolder(tree, "c", "d").ok).toBe(true);
    expect(canMoveFolder(tree, "c", null).ok).toBe(true);
  });
  it("limite la profondeur", () => {
    const deep = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => ({ id: `n${i}`, parentId: i ? `n${i - 1}` : null, name: `n${i}` }));
    expect(canMoveFolder([...deep, { id: "x", parentId: null, name: "x" }], "x", `n${MAX_FOLDER_DEPTH - 1}`).ok).toBe(false);
  });
  it("ne boucle pas sur des données déjà cycliques", () => {
    const bad = [{ id: "x", parentId: "y", name: "x" }, { id: "y", parentId: "x", name: "y" }];
    expect(descendantIds(bad, "x")).toEqual(["y"]);
    expect(pathTo(bad, "x").length).toBe(2);
  });
  it("génère des noms uniques insensibles à la casse et aux accents", () => {
    expect(uniqueName("Cours", ["cours", "Cours (2)"])).toBe("Cours (3)");
    expect(nameKey("Éléments")).toBe(nameKey("elements"));
  });
  it("valide les noms", () => {
    expect(validateFolderName("")).not.toBeNull();
    expect(validateFolderName("a/b")).not.toBeNull();
    expect(validateFolderName("Chapitre 1")).toBeNull();
  });
});

describe("validation des fichiers", () => {
  it("détecte le format par extension", () => {
    expect(detectKind("Cours.PDF")).toBe("pdf");
    expect(detectKind("virus.exe")).toBeNull();
    expect(detectKind("sans-extension")).toBeNull();
  });
  it("contrôle la signature", () => {
    expect(matchesSignature("pdf", Buffer.from("%PDF-1.7\n..."))).toBe(true);
    expect(matchesSignature("pdf", Buffer.from("MZ\x90\x00"))).toBe(false);
    expect(matchesSignature("docx", Buffer.from([0x50, 0x4b, 3, 4]))).toBe(true);
    expect(matchesSignature("docx", Buffer.from("%PDF-"))).toBe(false);
    expect(matchesSignature("txt", Buffer.from([65, 0, 66]))).toBe(false);
    expect(matchesSignature("txt", Buffer.alloc(0))).toBe(false);
  });
  it("nettoie les noms", () => {
    expect(sanitizeName("..\\..\\etc/passwd")).toBe("passwd");
    expect(sanitizeName("a\u0000b\n c.pdf")).toBe("ab c.pdf");
  });
});

describe("découpage", () => {
  const text = "--- Page 1 ---\n\n" + "Les fonctions sont des blocs réutilisables. ".repeat(60) + "\n\n--- Page 2 ---\n\nTrop court";
  it("sépare les pages et ignore les pages vides", () => {
    const pages = splitPages(text);
    expect(pages.map((p) => p.page)).toEqual([1, 2]);
    const chunks = chunkPages(pages);
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1]));
  });
  it("produit des décalages cohérents avec le contenu", () => {
    const pages = splitPages(text);
    for (const c of chunkPages(pages)) {
      expect(pages[0].text.slice(c.charStart, c.charEnd)).toBe(c.content);
    }
  });
  it("gère un texte sans pages", () => {
    expect(splitPages("juste du texte")[0].page).toBeNull();
  });
});
