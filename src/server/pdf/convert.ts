import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import mammoth from "mammoth";
import JSZip from "jszip";

// ─────────────────────────────────────────────────────────────────────────────
// Conversion des documents importés en PDF (aperçu en lecture seule).
// 100 % JavaScript : aucune dépendance native ni LibreOffice, donc compatible avec un hébergement
// serverless. La mise en page est RECONSTRUITE (titres, paragraphes, listes, tableaux, images,
// code), pas copiée à l'identique : polices, marges, colonnes, formes et animations d'origine
// ne sont pas reproduites. L'original reste conservé et téléchargeable.
// ─────────────────────────────────────────────────────────────────────────────

export const CONVERTIBLE_KINDS = ["docx", "pptx", "txt", "md"] as const;
export type ConvertibleKind = (typeof CONVERTIBLE_KINDS)[number];

export function canConvertToPdf(kind: string): kind is ConvertibleKind {
  return (CONVERTIBLE_KINDS as readonly string[]).includes(kind);
}

const MAX_PAGES = 600;

export interface ConvertResult {
  pdf: Buffer;
  pageCount: number;
  truncated: boolean;
}

// ── Modèle intermédiaire ─────────────────────────────────────────────────────

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
}

export type Block =
  | { t: "heading"; level: number; runs: Run[] }
  | { t: "para"; runs: Run[]; bullet?: string; depth?: number }
  | { t: "code"; text: string; plain?: boolean }
  | { t: "table"; rows: Run[][][] }
  | { t: "image"; bytes: Uint8Array; format: "png" | "jpg" }
  | { t: "rule" };

const hasContent = (runs: Run[]) => runs.some((r) => r.text.replace(/\s/g, "").length > 0);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

// ── HTML (sortie de mammoth) → blocs ─────────────────────────────────────────

export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  let runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  let mono = 0;
  let heading = 0;
  let bullet: string | undefined;
  let pre: string | null = null;
  let table: Run[][][] | null = null;
  let row: Run[][] | null = null;
  let cell: Run[] | null = null;

  const target = () => cell ?? runs;
  const flush = () => {
    if (hasContent(runs)) {
      if (heading) blocks.push({ t: "heading", level: heading, runs });
      else blocks.push({ t: "para", runs, bullet, depth: bullet ? Math.max(0, lists.length - 1) : 0 });
    }
    runs = [];
    bullet = undefined;
  };

  const tokens = html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g);
  for (const m of tokens) {
    if (m[4] !== undefined) {
      if (pre !== null) pre += decodeEntities(m[4]);
      else target().push({ text: decodeEntities(m[4]).replace(/\s+/g, " "), bold: bold > 0, italic: italic > 0, mono: mono > 0 });
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";
    if (pre !== null && !(closing && tag === "pre")) {
      if (tag === "br") pre += "\n";
      continue;
    }
    switch (tag) {
      case "strong":
      case "b":
        bold += closing ? -1 : 1;
        break;
      case "em":
      case "i":
        italic += closing ? -1 : 1;
        break;
      case "code":
        mono += closing ? -1 : 1;
        break;
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
        if (cell) break;
        flush();
        heading = closing ? 0 : Number(tag[1]);
        break;
      case "p":
        if (cell) {
          if (closing) cell.push({ text: " " });
        } else if (closing) {
          flush();
        } else if (!bullet) {
          flush();
        }
        break;
      case "ul":
      case "ol":
        if (!cell) flush();
        if (closing) lists.pop();
        else lists.push({ ordered: tag === "ol", n: 0 });
        break;
      case "li":
        if (cell) {
          if (!closing) cell.push({ text: " • " });
          break;
        }
        flush();
        if (!closing) {
          const l = lists[lists.length - 1];
          if (l) l.n += 1;
          bullet = l?.ordered ? `${l.n}.` : "•";
        }
        break;
      case "br":
        target().push({ text: "\n" });
        break;
      case "hr":
        flush();
        blocks.push({ t: "rule" });
        break;
      case "pre":
        if (closing) {
          if (pre && pre.trim()) blocks.push({ t: "code", text: pre.replace(/\n+$/, "") });
          pre = null;
        } else {
          flush();
          pre = "";
        }
        break;
      case "table":
        if (closing) {
          if (table && table.length) blocks.push({ t: "table", rows: table });
          table = null;
        } else {
          flush();
          table = [];
        }
        break;
      case "tr":
        if (!table) break;
        if (closing) {
          if (row?.length) table.push(row);
          row = null;
        } else row = [];
        break;
      case "td":
      case "th":
        if (!row) break;
        if (closing) {
          if (cell) row.push(cell);
          cell = null;
        } else cell = [];
        break;
      case "img": {
        if (cell) break;
        const src = /src="data:image\/(png|jpe?g);base64,([^"]+)"/i.exec(attrs);
        if (src) {
          flush();
          blocks.push({ t: "image", format: src[1].toLowerCase() === "png" ? "png" : "jpg", bytes: Buffer.from(src[2], "base64") });
        }
        break;
      }
      default:
        break;
    }
  }
  flush();
  return blocks;
}

// ── Markdown → blocs ─────────────────────────────────────────────────────────

export function inlineMarkdown(text: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?=\S)(.+?)(?<=\S)\3|`([^`]+)`|!?\[([^\]]*)\]\(([^)]*)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else if (m[4] !== undefined) out.push({ text: m[4], italic: true });
    else if (m[5] !== undefined) out.push({ text: m[5], mono: true });
    else out.push({ text: m[6] || m[7] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

export function markdownToBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: "para", runs: inlineMarkdown(para.join(" ")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*(```|~~~)/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ t: "code", text: code.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara();
      blocks.push({ t: "heading", level: h[1].length, runs: inlineMarkdown(h[2]) });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      blocks.push({ t: "rule" });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? "")) {
      flushPara();
      const split = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inlineMarkdown(c.trim()));
      const rows: Run[][][] = [split(line).map((c) => c.map((r) => ({ ...r, bold: true })))];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(split(lines[i++]));
      i--;
      blocks.push({ t: "table", rows });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      blocks.push({
        t: "para",
        runs: inlineMarkdown(li[3]),
        bullet: /\d/.test(li[2]) ? li[2] : "•",
        depth: Math.min(4, Math.floor(li[1].replace(/\t/g, "    ").length / 2)),
      });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      if (q[1].trim()) blocks.push({ t: "para", runs: inlineMarkdown(q[1]).map((r) => ({ ...r, italic: true })), depth: 1 });
      continue;
    }
    if (line.trim() === "") flushPara();
    else para.push(line.trim());
  }
  flushPara();
  return blocks;
}

// ── Rendu PDF ────────────────────────────────────────────────────────────────

const A4: [number, number] = [595.28, 841.89];
const INK = rgb(0.1, 0.1, 0.12);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
  mono: PDFFont;
}

interface Seg {
  text: string;
  font: PDFFont;
  size: number;
  width: number;
}

class Writer {
  pages = 0;
  truncated = false;
  page!: PDFPage;
  y = 0;
  size: [number, number] = A4;
  margin = 56;
  private encodable = new Map<string, boolean>();

  constructor(readonly pdf: PDFDocument, readonly f: Fonts) {}

  get width() {
    return this.size[0] - 2 * this.margin;
  }

  newPage(size: [number, number] = this.size) {
    if (this.pages >= MAX_PAGES) {
      this.truncated = true;
      return false;
    }
    this.size = size;
    this.page = this.pdf.addPage(size);
    this.pages++;
    this.y = size[1] - this.margin;
    return true;
  }

  /** S'assure qu'il reste `h` points ; sinon nouvelle page. Faux si la limite de pages est atteinte. */
  ensure(h: number): boolean {
    if (this.y - h >= this.margin || this.y === this.size[1] - this.margin) return true;
    return this.newPage();
  }

  /** Ne garde que les caractères que la police standard sait encoder. */
  sanitize(text: string): string {
    const map: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "≠": "!=", "ﬁ": "fi", "ﬂ": "fl", "\t": "    ", "\u00a0": " ", "\u2009": " ", "\u202f": " ", "−": "-" };
    let out = "";
    for (const ch of text) {
      if (map[ch] !== undefined) {
        out += map[ch];
        continue;
      }
      const code = ch.codePointAt(0)!;
      if (code < 32 && ch !== "\n") continue;
      if (code < 127) {
        out += ch;
        continue;
      }
      let ok = this.encodable.get(ch);
      if (ok === undefined) {
        try {
          this.f.regular.encodeText(ch);
          ok = true;
        } catch {
          ok = false;
        }
        this.encodable.set(ch, ok);
      }
      out += ok ? ch : "?";
    }
    return out;
  }

  private fontFor(r: Run, forceBold = false): PDFFont {
    if (r.mono) return this.f.mono;
    const b = forceBold || r.bold;
    return b && r.italic ? this.f.boldItalic : b ? this.f.bold : r.italic ? this.f.italic : this.f.regular;
  }

  /** Découpe des segments stylés en lignes de largeur maximale `maxWidth`. */
  wrap(runs: Run[], size: number, maxWidth: number, forceBold = false): Seg[][] {
    const lines: Seg[][] = [[]];
    let used = 0;
    const cur = () => lines[lines.length - 1];
    const brk = () => {
      const l = cur();
      while (l.length && /^\s+$/.test(l[l.length - 1].text)) l.pop();
      lines.push([]);
      used = 0;
    };
    for (const run of runs) {
      const font = this.fontFor(run, forceBold);
      const text = this.sanitize(run.text);
      for (const part of text.split(/(\n)/)) {
        if (part === "\n") {
          brk();
          continue;
        }
        for (const tok of part.split(/(\s+)/)) {
          if (!tok) continue;
          const isSpace = /^\s+$/.test(tok);
          const t = isSpace ? " " : tok;
          const w = font.widthOfTextAtSize(t, size);
          if (isSpace) {
            if (used > 0) {
              cur().push({ text: t, font, size, width: w });
              used += w;
            }
            continue;
          }
          if (used + w > maxWidth && used > 0) brk();
          if (w > maxWidth) {
            // mot plus large que la ligne : coupure au caractère
            let piece = "";
            for (const ch of t) {
              if (font.widthOfTextAtSize(piece + ch, size) > maxWidth && piece) {
                cur().push({ text: piece, font, size, width: font.widthOfTextAtSize(piece, size) });
                brk();
                piece = "";
              }
              piece += ch;
            }
            if (piece) {
              const pw = font.widthOfTextAtSize(piece, size);
              cur().push({ text: piece, font, size, width: pw });
              used += pw;
            }
          } else {
            cur().push({ text: t, font, size, width: w });
            used += w;
          }
        }
      }
    }
    while (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
    return lines;
  }

  drawLine(segs: Seg[], x: number, top: number, size: number) {
    let cx = x;
    for (const s of segs) {
      if (s.text.trim()) this.page.drawText(s.text, { x: cx, y: top - size, size, font: s.font, color: INK });
      cx += s.width;
    }
  }

  paragraph(runs: Run[], opts: { size: number; x?: number; maxWidth?: number; bold?: boolean; bullet?: string; after?: number; before?: number; leading?: number }) {
    const { size } = opts;
    const leading = size * (opts.leading ?? 1.38);
    const x = opts.x ?? this.margin;
    const maxWidth = opts.maxWidth ?? this.width;
    const lines = this.wrap(runs, size, maxWidth, opts.bold);
    if (opts.before && this.y !== this.size[1] - this.margin) this.y -= opts.before;
    lines.forEach((line, i) => {
      if (!this.ensure(leading)) return;
      if (i === 0 && opts.bullet) {
        const bw = this.f.regular.widthOfTextAtSize(opts.bullet, size);
        this.page.drawText(this.sanitize(opts.bullet), { x: x - bw - 5, y: this.y - size, size, font: this.f.regular, color: INK });
      }
      this.drawLine(line, x, this.y, size);
      this.y -= leading;
    });
    this.y -= opts.after ?? 0;
  }

  code(text: string, plain: boolean) {
    const size = plain ? 9.5 : 8.5;
    const leading = size * 1.3;
    const pad = plain ? 0 : 6;
    const perLine = Math.max(10, Math.floor((this.width - 2 * pad) / (0.6 * size)));
    const rows: string[] = [];
    for (const raw of this.sanitize(text).split("\n")) {
      if (raw.length === 0) rows.push("");
      for (let i = 0; i < raw.length; i += perLine) rows.push(raw.slice(i, i + perLine));
    }
    for (const r of rows) {
      if (!this.ensure(leading)) return;
      if (!plain) this.page.drawRectangle({ x: this.margin, y: this.y - leading + 1, width: this.width, height: leading, color: rgb(0.95, 0.95, 0.96) });
      if (r) this.page.drawText(r, { x: this.margin + pad, y: this.y - size, size, font: this.f.mono, color: INK });
      this.y -= leading;
    }
    this.y -= plain ? 0 : 8;
  }

  table(rows: Run[][][]) {
    const cols = Math.max(...rows.map((r) => r.length));
    if (!cols) return;
    const size = 9;
    const leading = size * 1.3;
    const pad = 4;
    const colW = this.width / cols;
    this.y -= 4;
    for (const row of rows) {
      const wrapped = Array.from({ length: cols }, (_, c) => this.wrap(row[c] ?? [], size, colW - 2 * pad));
      const height = Math.max(...wrapped.map((l) => l.length)) * leading + 2 * pad;
      if (!this.ensure(Math.min(height, this.size[1] - 2 * this.margin))) return;
      wrapped.forEach((lines, c) => {
        const x = this.margin + c * colW;
        this.page.drawRectangle({ x, y: this.y - height, width: colW, height, borderColor: rgb(0.7, 0.7, 0.72), borderWidth: 0.5 });
        lines.forEach((line, i) => this.drawLine(line, x + pad, this.y - pad - i * leading, size));
      });
      this.y -= height;
    }
    this.y -= 10;
  }

  async image(bytes: Uint8Array, format: "png" | "jpg", maxWidth = this.width, maxHeight = this.size[1] - 2 * this.margin) {
    let img: PDFImage;
    try {
      img = format === "png" ? await this.pdf.embedPng(bytes) : await this.pdf.embedJpg(bytes);
    } catch {
      return; // image illisible : ignorée
    }
    const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    if (!this.ensure(h)) return;
    this.page.drawImage(img, { x: this.margin, y: this.y - h, width: w, height: h });
    this.y -= h + 8;
  }

  rule() {
    if (!this.ensure(12)) return;
    this.y -= 4;
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.margin + this.width, y: this.y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.72) });
    this.y -= 8;
  }
}

const HEADING_SIZES = [22, 18, 15, 13, 12, 11];

async function createWriter(): Promise<Writer> {
  const pdf = await PDFDocument.create();
  const [regular, bold, italic, boldItalic, mono] = await Promise.all([
    pdf.embedFont(StandardFonts.Helvetica),
    pdf.embedFont(StandardFonts.HelveticaBold),
    pdf.embedFont(StandardFonts.HelveticaOblique),
    pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    pdf.embedFont(StandardFonts.Courier),
  ]);
  return new Writer(pdf, { regular, bold, italic, boldItalic, mono });
}

async function renderBlocks(w: Writer, blocks: Block[]) {
  for (const b of blocks) {
    if (w.truncated) break;
    switch (b.t) {
      case "heading": {
        const size = HEADING_SIZES[Math.min(5, Math.max(0, b.level - 1))];
        // un titre ne reste jamais seul en bas de page
        w.ensure(size * 1.38 + 40);
        w.paragraph(b.runs, { size, bold: true, before: size * 0.7, after: size * 0.3 });
        break;
      }
      case "para": {
        const indent = b.bullet ? 18 + (b.depth ?? 0) * 16 : (b.depth ?? 0) * 18;
        w.paragraph(b.runs, { size: 10.5, x: w.margin + indent, maxWidth: w.width - indent, bullet: b.bullet, after: b.bullet ? 2 : 7 });
        break;
      }
      case "code":
        w.code(b.text, !!b.plain);
        break;
      case "table":
        w.table(b.rows);
        break;
      case "image":
        await w.image(b.bytes, b.format);
        break;
      case "rule":
        w.rule();
        break;
    }
  }
}

async function finish(w: Writer, title?: string): Promise<ConvertResult> {
  if (w.pages === 0) w.newPage();
  if (w.truncated) {
    const last = w.pdf.getPage(w.pdf.getPageCount() - 1);
    last.drawText("Aperçu tronqué : document trop long. Téléchargez l'original pour le lire en entier.", { x: 56, y: 30, size: 8, font: w.f.italic, color: rgb(0.6, 0.1, 0.1) });
  }
  if (title) w.pdf.setTitle(w.sanitize(title));
  w.pdf.setProducer("Aperçu PDF généré à l'import");
  const bytes = await w.pdf.save();
  return { pdf: Buffer.from(bytes), pageCount: w.pdf.getPageCount(), truncated: w.truncated };
}

// ── Formats ──────────────────────────────────────────────────────────────────

async function docxToPdf(buffer: Buffer): Promise<ConvertResult> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const w = await createWriter();
  w.newPage();
  await renderBlocks(w, htmlToBlocks(html));
  return finish(w);
}

async function textToPdf(buffer: Buffer): Promise<ConvertResult> {
  const w = await createWriter();
  w.newPage();
  w.code(buffer.toString("utf8").replace(/\r\n?/g, "\n"), true);
  return finish(w);
}

async function markdownToPdf(buffer: Buffer): Promise<ConvertResult> {
  const w = await createWriter();
  w.newPage();
  await renderBlocks(w, markdownToBlocks(buffer.toString("utf8")));
  return finish(w);
}

// PPTX : une page par diapositive, au format de la présentation. Le contenu est empilé dans l'ordre
// du fichier (titre, puis zones de texte et images) ; les positions exactes ne sont pas reproduites.

const EMU_PER_PT = 12700;

interface SlideItem {
  kind: "title" | "text" | "image";
  paragraphs?: { runs: Run[]; bullet: boolean; level: number }[];
  rId?: string;
}

export function parseSlide(xml: string): SlideItem[] {
  const items: SlideItem[] = [];
  const shapes = xml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g);
  for (const m of shapes) {
    const shape = m[0];
    if (m[1] === "pic") {
      const rId = /r:embed="([^"]+)"/.exec(shape)?.[1];
      if (rId) items.push({ kind: "image", rId });
      continue;
    }
    const isTitle = /<p:ph[^>]*type="(?:title|ctrTitle)"/.test(shape);
    const paragraphs: NonNullable<SlideItem["paragraphs"]> = [];
    for (const p of shape.matchAll(/<a:p>([\s\S]*?)<\/a:p>|<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
      const inner = p[1] ?? p[2] ?? "";
      const runs: Run[] = [];
      for (const r of inner.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:br\s*\/>/g)) {
        if (!r[1]) {
          runs.push({ text: "\n" });
          continue;
        }
        const t = /<a:t>([\s\S]*?)<\/a:t>/.exec(r[1]);
        if (!t) continue;
        runs.push({ text: decodeEntities(t[1]), bold: /<a:rPr[^>]*\bb="1"/.test(r[1]), italic: /<a:rPr[^>]*\bi="1"/.test(r[1]) });
      }
      if (!hasContent(runs)) continue;
      const lvl = Number(/<a:pPr[^>]*\blvl="(\d)"/.exec(inner)?.[1] ?? 0);
      paragraphs.push({ runs, bullet: !isTitle && !/<a:buNone\s*\/>/.test(inner), level: lvl });
    }
    if (paragraphs.length) items.push({ kind: isTitle ? "title" : "text", paragraphs });
  }
  return items;
}

async function pptxToPdf(buffer: Buffer): Promise<ConvertResult> {
  const zip = await JSZip.loadAsync(buffer);
  const presentation = (await zip.file("ppt/presentation.xml")?.async("text")) ?? "";
  const sz = /<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(presentation);
  const size: [number, number] = sz ? [Number(sz[1]) / EMU_PER_PT, Number(sz[2]) / EMU_PER_PT] : [720, 405];
  const scale = size[0] > 1000 ? 1000 / size[0] : 1;
  const pageSize: [number, number] = [size[0] * scale, size[1] * scale];

  const w = await createWriter();
  w.margin = Math.max(24, pageSize[0] * 0.05);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)?.[1]) - Number(b.match(/(\d+)/)?.[1]));

  const base = Math.max(12, pageSize[0] / 48);
  for (const file of slideFiles) {
    if (!w.newPage(pageSize)) break;
    w.page.drawRectangle({ x: 0, y: 0, width: pageSize[0], height: pageSize[1], borderColor: rgb(0.85, 0.85, 0.87), borderWidth: 1 });
    const num = file.match(/(\d+)/)![1];
    const rels = (await zip.file(`ppt/slides/_rels/slide${num}.xml.rels`)?.async("text")) ?? "";
    const targets = new Map<string, string>();
    for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /\bId="([^"]+)"/.exec(r[0])?.[1];
      const target = /\bTarget="([^"]+)"/.exec(r[0])?.[1];
      if (id && target) targets.set(id, target);
    }
    for (const item of parseSlide(await zip.files[file].async("text"))) {
      if (w.truncated) break;
      if (item.kind === "image") {
        const target = targets.get(item.rId!);
        const name = target?.replace(/^\.\.\//, "ppt/");
        const ext = name?.split(".").pop()?.toLowerCase();
        const data = name && (ext === "png" || ext === "jpg" || ext === "jpeg") ? await zip.file(name)?.async("uint8array") : undefined;
        if (data) await w.image(data, ext === "png" ? "png" : "jpg", pageSize[0] * 0.7, pageSize[1] * 0.5);
        continue;
      }
      for (const p of item.paragraphs!) {
        if (item.kind === "title") w.paragraph(p.runs, { size: base * 1.8, bold: true, after: base * 0.6 });
        else {
          const indent = p.bullet ? base * 1.2 + p.level * base : 0;
          w.paragraph(p.runs, { size: base, x: w.margin + indent, maxWidth: w.width - indent, bullet: p.bullet ? "•" : undefined, after: base * 0.35 });
        }
      }
    }
  }
  return finish(w);
}

/** Point d'entrée : convertit un document importé en PDF (lève une erreur si le format n'est pas convertible). */
export async function convertToPdf(kind: string, buffer: Buffer): Promise<ConvertResult> {
  switch (kind) {
    case "docx":
      return docxToPdf(buffer);
    case "pptx":
      return pptxToPdf(buffer);
    case "txt":
      return textToPdf(buffer);
    case "md":
      return markdownToPdf(buffer);
    default:
      throw new Error(`Conversion PDF non prise en charge : ${kind}`);
  }
}
