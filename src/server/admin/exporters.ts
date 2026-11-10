import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Cell, Report } from "@/server/admin/reports";

// Exports : CSV (Excel FR : séparateur « ; », UTF-8 avec BOM), Excel (.xlsx écrit à la main avec JSZip) et PDF (pdf-lib).
// Les cellules textuelles qui commencent par = + - @ sont neutralisées (injection de formules dans un tableur).

const dangerous = /^[=+\-@\t\r]/;
const safeText = (v: string) => (dangerous.test(v) ? `'${v}` : v);
const cellText = (c: Cell) => (c == null ? "" : typeof c === "number" ? String(c) : safeText(c));

export function renderCsv(report: Report): string {
  const esc = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [esc(report.title), esc(`Période : ${report.period.label}`), esc(`Généré le ${report.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`), ""];
  for (const note of report.notes) lines.push(esc(note));
  for (const t of report.tables) {
    lines.push("", esc(t.title), t.columns.map(esc).join(";"));
    for (const r of t.rows) lines.push(r.map((c) => esc(cellText(c))).join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ── Excel ────────────────────────────────────────────────────────────────────
const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const colName = (i: number) => {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};
const sheetName = (s: string, used: Set<string>) => {
  // Excel refuse \ / ? * [ ] : dans un nom de feuille, ainsi qu'une apostrophe au début ou à la fin ; 31 caractères au plus.
  const base = s.replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 28).trim() || "Feuille";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 25)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

function sheetXml(rows: Cell[][], headerRows: Set<number>): string {
  const data = rows
    .map((row, r) => {
      const cells = row
        .map((c, i) => {
          const ref = `${colName(i)}${r + 1}`;
          if (c == null || c === "") return "";
          const style = headerRows.has(r) ? ' s="1"' : "";
          return typeof c === "number" && Number.isFinite(c) ? `<c r="${ref}"${style}><v>${c}</v></c>` : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(safeText(String(c)))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const width = Math.max(...rows.map((r) => r.length), 1);
  const cols = Array.from({ length: width }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 0 ? 38 : 16}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${data}</sheetData></worksheet>`;
}

export async function renderXlsx(report: Report): Promise<Buffer> {
  const used = new Set<string>();
  const sheets: { name: string; xml: string }[] = [];
  const summary: Cell[][] = [[report.title], [`Période : ${report.period.label}`], [`Généré le ${report.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`], [], ...report.notes.map((n): Cell[] => [n])];
  sheets.push({ name: sheetName("Résumé", used), xml: sheetXml(summary, new Set([0])) });
  for (const t of report.tables) sheets.push({ name: sheetName(t.title, used), xml: sheetXml([t.columns, ...t.rows], new Set([0])) });
  for (const c of report.charts) sheets.push({ name: sheetName(`Données — ${c.title}`, used), xml: sheetXml([["Période", c.title], ...c.labels.map((l, i): Cell[] => [l, c.values[i] ?? 0])], new Set([0])) });

  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, s.xml));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ── PDF ──────────────────────────────────────────────────────────────────────
const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const ink = rgb(0.12, 0.1, 0.18);
const muted = rgb(0.4, 0.38, 0.46);
const accent = rgb(0.45, 0.28, 0.82);

/** pdf-lib (polices standard) n'encode que le Latin-1/WinAnsi : tout le reste est remplacé plutôt que de faire échouer l'export. */
const win = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[–—]/g, "-").replace(/ | /g, " ").replace(/[^\x20-\x7E¡-ÿ€]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of win(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

export async function renderPdf(report: Report): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - MARGIN;
  const width = A4[0] - MARGIN * 2;
  const ensure = (h: number) => {
    if (y - h < MARGIN + 14) {
      page = pdf.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };
  const text = (s: string, size = 9, f = font, color = ink, x = MARGIN) => {
    for (const l of wrap(s, f, size, width - (x - MARGIN))) {
      ensure(size + 3);
      page.drawText(l, { x, y: y - size, size, font: f, color });
      y -= size + 3;
    }
  };

  text("Niala — Back-office", 9, bold, accent);
  y -= 2;
  text(report.title, 18, bold);
  text(`Période : ${report.period.label}`, 10, font, muted);
  text(`Généré le ${report.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`, 8, font, muted);
  y -= 6;
  for (const n of report.notes) text(n, 8, font, muted);
  y -= 8;

  for (const chart of report.charts) {
    const h = 110;
    ensure(h + 30);
    text(chart.title, 11, bold);
    const top = y - 4;
    const values = chart.values;
    const max = Math.max(1, ...values);
    page.drawRectangle({ x: MARGIN, y: top - h, width, height: h, borderColor: rgb(0.85, 0.84, 0.9), borderWidth: 0.5 });
    if (values.length) {
      const step = width / values.length;
      if (chart.kind === "bar") {
        values.forEach((v, i) => {
          const bh = (v / max) * (h - 16);
          page.drawRectangle({ x: MARGIN + i * step + step * 0.15, y: top - h + 8, width: step * 0.7, height: Math.max(0.5, bh), color: accent });
        });
      } else {
        const pt = (v: number, i: number) => ({ x: MARGIN + (values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 16) + 8), y: top - h + 8 + (v / max) * (h - 16) });
        for (let i = 1; i < values.length; i++) page.drawLine({ start: pt(values[i - 1], i - 1), end: pt(values[i], i), thickness: 1.6, color: accent });
        if (values.length === 1) page.drawCircle({ ...pt(values[0], 0), size: 2.5, color: accent });
      }
    }
    page.drawText(win(`max ${max}`), { x: MARGIN + width - 50, y: top - 10, size: 7, font, color: muted });
    y = top - h - 4;
    if (chart.labels.length) text(`${win(chart.labels[0])}  ->  ${win(chart.labels.at(-1)!)}`, 7, font, muted);
    y -= 8;
  }

  for (const t of report.tables) {
    ensure(40);
    y -= 4;
    text(t.title, 12, bold);
    if (!t.rows.length) {
      text("Aucune donnée sur cette période.", 9, font, muted);
      continue;
    }
    const cols = Math.min(t.columns.length, 8); // au-delà (carte de chaleur), le tableau complet est dans le CSV et l'Excel
    const first = cols < t.columns.length ? "Les colonnes au-delà de la huitième figurent dans les exports CSV et Excel." : null;
    const colW = [Math.min(170, width * 0.34), ...Array(cols - 1).fill((width - Math.min(170, width * 0.34)) / Math.max(1, cols - 1))];
    const drawRow = (cells: Cell[], head: boolean) => {
      const f = head ? bold : font;
      const lines = cells.slice(0, cols).map((c, i) => wrap(head ? String(c ?? "") : cellText(c), f, 8, colW[i] - 6));
      const rowH = Math.max(...lines.map((l) => l.length)) * 10 + 4;
      ensure(rowH);
      if (head) page.drawRectangle({ x: MARGIN, y: y - rowH + 2, width, height: rowH, color: rgb(0.94, 0.93, 0.98) });
      let x = MARGIN;
      lines.forEach((ls, i) => {
        ls.forEach((l, k) => page.drawText(l, { x: x + 3, y: y - 9 - k * 10, size: 8, font: f, color: ink }));
        x += colW[i];
      });
      y -= rowH;
      page.drawLine({ start: { x: MARGIN, y: y + 2 }, end: { x: MARGIN + width, y: y + 2 }, thickness: 0.3, color: rgb(0.88, 0.87, 0.92) });
    };
    drawRow(t.columns, true);
    for (const r of t.rows.slice(0, 200)) drawRow(r, false);
    if (t.rows.length > 200) text(`… ${t.rows.length - 200} lignes supplémentaires dans les exports CSV et Excel.`, 8, font, muted);
    if (first) text(first, 7, font, muted);
    y -= 6;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(win(`Niala — ${report.title} — page ${i + 1}/${pages.length}`), { x: MARGIN, y: 22, size: 7, font, color: muted }));
  return Buffer.from(await pdf.save());
}
