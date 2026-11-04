import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { canConvertToPdf, convertToPdf, htmlToBlocks, markdownToBlocks, parseSlide } from "./convert";

async function pdfText(pdf: Buffer) {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text, totalPages } = await extractText(doc, { mergePages: false });
  return { pages: text as string[], totalPages };
}

describe("blocs", () => {
  it("HTML : titres, listes, tableaux", () => {
    const b = htmlToBlocks("<h1>Titre</h1><p>Un <strong>mot</strong> &amp; deux</p><ul><li>a</li><li>b</li></ul><table><tr><td><p>x</p></td><td>y</td></tr></table>");
    expect(b.map((x) => x.t)).toEqual(["heading", "para", "para", "para", "table"]);
    expect(b[2]).toMatchObject({ bullet: "•" });
    expect(b[1].t === "para" && b[1].runs.map((r) => r.text).join("")).toBe("Un mot & deux");
  });
  it("Markdown : titres, listes, code, tableaux", () => {
    const b = markdownToBlocks("# T\n\ntexte **gras**\n\n- un\n- deux\n\n```js\nlet a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(b.map((x) => x.t)).toEqual(["heading", "para", "para", "para", "code", "table"]);
  });
  it("PPTX : titre et texte", () => {
    const xml = '<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Bonjour</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:txBody><a:p><a:r><a:t>Point</a:t></a:r></a:p></p:txBody></p:sp>';
    expect(parseSlide(xml).map((i) => i.kind)).toEqual(["title", "text"]);
  });
});

describe("convertToPdf", () => {
  it("formats convertibles", () => {
    expect(["docx", "pptx", "txt", "md"].every(canConvertToPdf)).toBe(true);
    expect(canConvertToPdf("pdf")).toBe(false);
  });

  it("TXT : accents conservés, plusieurs pages si long", async () => {
    const text = Array.from({ length: 200 }, (_, i) => `Ligne ${i} — élève, œuvre, café ✓`).join("\n");
    const r = await convertToPdf("txt", Buffer.from(text));
    expect(r.pageCount).toBeGreaterThan(2);
    const { pages } = await pdfText(r.pdf);
    expect(pages[0]).toContain("élève");
    expect(pages[0]).toContain("café ?");
  });

  it("MD : rendu en PDF valide", async () => {
    const r = await convertToPdf("md", Buffer.from("# Cours\n\nUn paragraphe **important**.\n\n- point 1\n- point 2\n"));
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const { pages } = await pdfText(r.pdf);
    expect(pages.join(" ")).toContain("Cours");
    expect(pages.join(" ")).toContain("point 2");
  });

  it("DOCX : texte, titre et tableau", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Bonjour le monde</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cellule</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
    const r = await convertToPdf("docx", await zip.generateAsync({ type: "nodebuffer" }));
    const { pages } = await pdfText(r.pdf);
    expect(pages.join(" ")).toContain("Bonjour le monde");
    expect(pages.join(" ")).toContain("Cellule");
  });

  it("PPTX : une page par diapositive", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", '<p:presentation><p:sldSz cx="9144000" cy="5143500"/></p:presentation>');
    for (const n of [1, 2]) zip.file(`ppt/slides/slide${n}.xml`, `<p:sld><p:sp><p:txBody><a:p><a:r><a:t>Slide ${n}</a:t></a:r></a:p></p:txBody></p:sp></p:sld>`);
    const r = await convertToPdf("pptx", await zip.generateAsync({ type: "nodebuffer" }));
    expect(r.pageCount).toBe(2);
    const { pages } = await pdfText(r.pdf);
    expect(pages[1]).toContain("Slide 2");
  });
});
