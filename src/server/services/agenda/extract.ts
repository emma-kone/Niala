import JSZip from "jszip";
import mammoth from "mammoth";
import { ApiHttpError } from "@/lib/api-helpers";
import { pdfLayout, type PdfLayout } from "./pdf-layout";

// ─────────────────────────────────────────────────────────────────────────────
// Import d'un emploi du temps, étape 1 : extraction du contenu, sans aucune interprétation.
// Un format se déclare dans FORMATS. Le résultat est soit du texte, soit le fichier à faire lire par le modèle
// (PDF et images : la mise en page d'une grille porte l'information, et les scans n'ont pas de texte).
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const MAX_ROWS = 400;
const MAX_COLUMNS = 40;

export type Extracted = { kind: "text"; text: string; warnings: string[] } | { kind: "file"; mime: string; data: Buffer; warnings: string[]; layout?: PdfLayout | null };

interface Format {
  mime: string;
  signature: (b: Buffer) => boolean;
  extract: (b: Buffer) => Promise<Extracted>;
}

const starts = (b: Buffer, ...bytes: number[]) => bytes.every((x, i) => b[i] === x);
const isZip = (b: Buffer) => starts(b, 0x50, 0x4b, 0x03, 0x04);

/** Protège contre les archives qui se décompressent en quantités démesurées. */
async function openZip(bytes: Buffer): Promise<JSZip> {
  const zip = await JSZip.loadAsync(bytes);
  let total = 0;
  zip.forEach((_p, f) => {
    total += (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  });
  if (total > MAX_UNZIPPED_BYTES) throw new ApiHttpError("Ce fichier est trop volumineux une fois décompressé.", 413);
  return zip;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function clip(text: string, warnings: string[]): Extracted {
  if (!text.trim()) throw new ApiHttpError("Aucun texte n'a pu être extrait de ce fichier.", 422);
  if (text.length > MAX_TEXT_CHARS) warnings.push("Le document est très long : seul son début a été analysé.");
  return { kind: "text", text: text.slice(0, MAX_TEXT_CHARS), warnings };
}

const colIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((t, c) => t * 26 + c.charCodeAt(0) - 64, 0) - 1;
const rowIndex = (ref: string) => Number(ref.replace(/\D+/g, "")) - 1;

/** Une fraction de journée (0,3125) est une heure Excel (07:30). */
function excelValue(v: string): string {
  const n = Number(v);
  if (v.includes(".") && n > 0 && n < 1) {
    const total = Math.round(n * 1440);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  return v;
}

/** Lit un classeur XLSX en tableaux tabulés. Les cellules fusionnées, fréquentes dans une grille, sont recopiées. */
export async function extractXlsx(bytes: Buffer): Promise<Extracted> {
  const zip = await openZip(bytes);
  const shared = zip.file("xl/sharedStrings.xml");
  const strings = shared ? [...(await shared.async("string")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))) : [];
  const sheets = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  if (!sheets.length) throw new ApiHttpError("Ce classeur ne contient aucune feuille lisible.", 422);
  const parts: string[] = [];
  for (const name of sheets.slice(0, 6)) {
    const xml = await zip.file(name)!.async("string");
    const grid: string[][] = [];
    for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, attrs, inner] = c;
      const r = rowIndex(ref);
      const col = colIndex(ref);
      if (r >= MAX_ROWS || col >= MAX_COLUMNS || !inner) continue;
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const value = /t="s"/.test(attrs) ? (strings[Number(raw)] ?? "") : inline !== undefined ? decodeXml(inline) : raw !== undefined ? excelValue(raw) : "";
      (grid[r] ??= [])[col] = clean(value);
    }
    for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const value = grid[rowIndex(m[1])]?.[colIndex(m[1])];
      if (!value) continue;
      for (let r = rowIndex(m[1]); r <= Math.min(rowIndex(m[2]), MAX_ROWS - 1); r++) {
        for (let col = colIndex(m[1]); col <= Math.min(colIndex(m[2]), MAX_COLUMNS - 1); col++) (grid[r] ??= [])[col] = value;
      }
    }
    const lines = Array.from(grid, (row) => Array.from(row ?? [], (x) => x ?? "").join(" | ")).filter((l) => l.replace(/[| ]/g, ""));
    if (lines.length) parts.push(lines.join("\n"));
  }
  return clip(parts.join("\n\n--- feuille suivante ---\n\n"), []);
}

export async function extractDocx(bytes: Buffer): Promise<Extracted> {
  await openZip(bytes);
  const { value } = await mammoth.convertToHtml({ buffer: bytes });
  const text = decodeXml(
    value
      // Une cellule reste sur une seule ligne, même si elle contient plusieurs paragraphes.
      .replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g, (_m, cell: string) => `${cell.replace(/<[^>]+>/g, " ")} | `)
      .replace(/<\/(tr|p|li|h\d)>/g, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map(clean)
    .filter(Boolean)
    .join("\n");
  return clip(text, []);
}

export function extractCsv(bytes: Buffer): Extracted {
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  const utf8 = body.toString("utf8");
  return clip(utf8.includes("�") ? body.toString("latin1") : utf8, []);
}

const asFile = (mime: string) => async (data: Buffer): Promise<Extracted> => ({ kind: "file", mime, data, warnings: [] });

/** Le PDF part au modèle tel quel ; s'il a une couche de texte en grille, la position des cellules l'accompagne. */
async function extractPdf(data: Buffer): Promise<Extracted> {
  const layout = await pdfLayout(data).catch((e) => {
    console.warn("[agenda] relevé des colonnes impossible :", e instanceof Error ? e.message : e);
    return null;
  });
  return { kind: "file", mime: "application/pdf", data, warnings: [], layout };
}

const FORMATS: Record<string, Format> = {
  pdf: { mime: "application/pdf", signature: (b) => starts(b, 0x25, 0x50, 0x44, 0x46), extract: extractPdf },
  png: { mime: "image/png", signature: (b) => starts(b, 0x89, 0x50, 0x4e, 0x47), extract: asFile("image/png") },
  jpg: { mime: "image/jpeg", signature: (b) => starts(b, 0xff, 0xd8, 0xff), extract: asFile("image/jpeg") },
  jpeg: { mime: "image/jpeg", signature: (b) => starts(b, 0xff, 0xd8, 0xff), extract: asFile("image/jpeg") },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signature: isZip, extract: extractDocx },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", signature: isZip, extract: extractXlsx },
  csv: { mime: "text/csv", signature: (b) => !b.includes(0), extract: async (b) => extractCsv(b) },
};

export const ACCEPTED_EXTENSIONS = Object.keys(FORMATS);

const extensionOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";

/** Valide le fichier (taille, extension, contenu réel) et renvoie son format. */
export function identifyFile(name: string, bytes: Buffer): { extension: string; mime: string } {
  if (bytes.length === 0) throw new ApiHttpError("Ce fichier est vide.", 422);
  if (bytes.length > MAX_IMPORT_BYTES) throw new ApiHttpError(`Fichier trop volumineux (${MAX_IMPORT_BYTES / 1024 / 1024} Mo maximum).`, 413);
  const extension = extensionOf(name);
  if (extension === "xls") throw new ApiHttpError("L'ancien format .xls n'est pas pris en charge : enregistrez le fichier en .xlsx ou en PDF, puis réessayez.", 415);
  const format = FORMATS[extension];
  if (!format) throw new ApiHttpError(`Format non pris en charge. Formats acceptés : ${ACCEPTED_EXTENSIONS.join(", ")}.`, 415);
  if (!format.signature(bytes)) throw new ApiHttpError("Le contenu de ce fichier ne correspond pas à son extension.", 415);
  return { extension, mime: format.mime };
}

export async function extractContent(extension: string, bytes: Buffer): Promise<Extracted> {
  try {
    return await FORMATS[extension].extract(bytes);
  } catch (e) {
    if (e instanceof ApiHttpError) throw e;
    console.warn("[agenda] extraction impossible :", e instanceof Error ? e.message : e);
    throw new ApiHttpError("Ce fichier n'a pas pu être lu. Il est peut-être endommagé ou protégé par un mot de passe.", 422);
  }
}
