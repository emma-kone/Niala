// Détection DÉTERMINISTE de la structure d'un cours à partir de sa numérotation :
//   CHAPITRE II · I, II, III · A, B, C · 1, 2, 3 · 1.1, 1.2 · a, b, c · 1°, 2° · titres Markdown (#).
// Tout ce qui est produit ici est EXPLICITEMENT écrit dans le document (origin = DOCUMENT) :
// aucune IA, aucune déduction. La hiérarchie respecte l'ordre d'apparition des familles de numérotation.

export interface ParsedHeading {
  numbering: string; // tel qu'écrit : « II », « A », « 3 », « 1.2 », « a »
  label: string;
  level: number; // 0 = racine
  parentIndex: number | null; // indice dans le tableau de sortie
  page: number | null;
  line: string; // ligne d'origine (citation de provenance)
}

export interface ParsedStructure {
  headings: ParsedHeading[];
  /** Nombre de lignes candidates rejetées (hors séquence) : indicateur de fiabilité. */
  rejected: number;
}

type Family = "chapter" | "roman" | "upper" | "arabic" | "lower" | "ordinal" | `dec${number}` | `md${number}`;
interface Candidate {
  family: Family;
  token: string;
  value: number | null; // null : pas de séquence (Markdown)
  label: string;
  ambiguous?: boolean; // « I », « V », « X » : romain ou lettre ?
}

const ROMAN = /^(?=[IVXLCDM])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

export function romanToInt(s: string): number | null {
  if (!ROMAN.test(s)) return null;
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = map[s[i]];
    const next = map[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

const letterToInt = (c: string) => c.toLowerCase().charCodeAt(0) - 96;

const CHAPTER = /^(chapitre|chap\.?|partie|module|unité|unite|leçon|lecon|séance|seance|section)\s+([IVXLCDM]+|\d{1,3})\b\s*[:.\-–—)]?\s*(.*)$/i;
const MD = /^(#{1,6})\s+(\S.*)$/;
const DECIMAL = /^(\d{1,2}(?:\.\d{1,2}){1,4})\.?\s+(\S.*)$/;
const ORDINAL = /^(\d{1,3})\s*°\s*[.)\-–—:]?\s*(\S.*)$/;
const ARABIC = /^(\d{1,3})\s*[.)\-–—:]\s+(\S.*)$/;
const ROMAN_LINE = /^([IVXLCDM]{1,7})\s*[.)\-–—:]\s+(\S.*)$/;
const UPPER = /^([A-Z])\s*[.)\-–—:]\s+(\S.*)$/;
const LOWER = /^([a-z])\s*[.)]\s+(\S.*)$/;

const MAX_LINE = 110;

function looksLikeTitle(label: string): boolean {
  if (label.length < 2 || label.length > MAX_LINE) return false;
  if (/^[a-zà-ÿ]/.test(label) && label.split(/\s+/).length > 3) return false; // phrase de texte courant
  const words = label.split(/\s+/).length;
  if (words > 14) return false;
  if (words > 7 && /[.;,]$/.test(label)) return false; // phrase, pas un titre
  return true;
}

function classify(line: string): Candidate | null {
  let m: RegExpMatchArray | null;
  if ((m = line.match(MD))) return { family: `md${m[1].length}` as Family, token: m[1], value: null, label: m[2].replace(/#+\s*$/, "").trim() };
  if ((m = line.match(CHAPTER))) {
    const token = m[2];
    const value = /^\d+$/.test(token) ? Number(token) : romanToInt(token.toUpperCase());
    if (value == null) return null;
    return { family: "chapter", token: token.toUpperCase(), value, label: (m[3] || "").trim() || `${m[1]} ${token}` };
  }
  if (line.length > MAX_LINE) return null;
  if ((m = line.match(DECIMAL))) {
    const depth = m[1].split(".").length;
    const last = Number(m[1].split(".").pop());
    return looksLikeTitle(m[2]) ? { family: `dec${depth}` as Family, token: m[1], value: last, label: m[2].trim() } : null;
  }
  if ((m = line.match(ORDINAL))) return looksLikeTitle(m[2]) ? { family: "ordinal", token: `${m[1]}°`, value: Number(m[1]), label: m[2].trim() } : null;
  if ((m = line.match(ARABIC))) return looksLikeTitle(m[2]) ? { family: "arabic", token: m[1], value: Number(m[1]), label: m[2].trim() } : null;
  if ((m = line.match(ROMAN_LINE))) {
    const v = romanToInt(m[1]);
    if (v != null && looksLikeTitle(m[2])) {
      // « C. », « D. », « L. », « M. » seuls sont presque toujours des lettres
      if (m[1].length === 1 && !"IVX".includes(m[1])) {
        return { family: "upper", token: m[1], value: letterToInt(m[1]), label: m[2].trim() };
      }
      return { family: "roman", token: m[1], value: v, label: m[2].trim(), ambiguous: m[1].length === 1 };
    }
  }
  if ((m = line.match(UPPER))) return looksLikeTitle(m[2]) ? { family: "upper", token: m[1], value: letterToInt(m[1]), label: m[2].trim() } : null;
  if ((m = line.match(LOWER))) return looksLikeTitle(m[2]) ? { family: "lower", token: m[1], value: letterToInt(m[1]), label: m[2].trim() } : null;
  return null;
}

interface StackItem {
  family: Family;
  value: number | null;
  index: number;
}

export function parseStructure(pages: { page: number | null; text: string }[]): ParsedStructure {
  const headings: ParsedHeading[] = [];
  const stack: StackItem[] = [];
  let rejected = 0;
  let lastUpper = 0; // dernière lettre majuscule vue (désambiguïsation I/V/X)

  const push = (c: Candidate, page: number | null, line: string) => {
    headings.push({
      numbering: c.token,
      label: c.label,
      level: stack.length,
      parentIndex: stack.length ? stack[stack.length - 1].index : null,
      page,
      line,
    });
    stack.push({ family: c.family, value: c.value, index: headings.length - 1 });
  };

  for (const { page, text } of pages) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (!line) continue;
      let cand = classify(line);
      if (!cand) continue;

      // « I », « V », « X » : lettre si elle suit « H », « U », « W »… dans une séquence de lettres
      if (cand.family === "roman" && cand.ambiguous && cand.value != null) {
        const letterValue = letterToInt(cand.token);
        const inLetters = stack.some((s) => s.family === "upper");
        const letterExpected = inLetters && lastUpper + 1 === letterValue;
        const romanExpected = stack.some((s) => s.family === "roman" && s.value != null && s.value + 1 === cand!.value) ||
          (!stack.some((s) => s.family === "roman") && cand.value === 1);
        if (letterExpected && !romanExpected) cand = { ...cand, family: "upper", value: letterValue };
      }

      const idx = stack.findIndex((s) => s.family === cand!.family);
      if (cand.value == null) {
        // Markdown : pas de séquence, le niveau suit le nombre de « # »
        const level = Number(cand.family.slice(2));
        while (stack.length && Number(stack[stack.length - 1].family.slice(2)) >= level && stack[stack.length - 1].family.startsWith("md")) stack.pop();
        push(cand, page, line);
        continue;
      }
      if (idx >= 0) {
        const prev = stack[idx].value ?? 0;
        const ok = cand.family === "chapter" ? cand.value > prev : cand.value === prev + 1;
        if (!ok) {
          rejected++;
          continue;
        }
        stack.length = idx;
        push(cand, page, line);
      } else {
        const first = cand.family === "chapter" ? cand.value <= 2 : cand.value === 1;
        if (!first) {
          rejected++;
          continue;
        }
        // Un chapitre repart toujours de la racine
        if (cand.family === "chapter") stack.length = 0;
        push(cand, page, line);
      }
      if (cand.family === "upper" && cand.value != null) lastUpper = cand.value;
    }
  }
  return { headings: headings.length >= 2 ? headings : [], rejected };
}

/** Texte rattaché à chaque titre : de sa ligne jusqu'au titre suivant (tous niveaux). */
export function sectionTexts(
  pages: { page: number | null; text: string }[],
  headings: ParsedHeading[]
): { text: string; pageStart: number | null; pageEnd: number | null }[] {
  const out = headings.map(() => ({ buf: [] as string[], pageStart: null as number | null, pageEnd: null as number | null }));
  let cur = -1;
  let next = 0;
  for (const { page, text } of pages) {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (next < headings.length && line === headings[next].line) {
        cur = next++;
        out[cur].pageStart = page;
        out[cur].buf.push(line);
        out[cur].pageEnd = page;
        continue;
      }
      if (cur >= 0 && line) {
        out[cur].buf.push(line);
        out[cur].pageEnd = page;
      }
    }
  }
  return out.map((o) => ({ text: o.buf.join("\n"), pageStart: o.pageStart, pageEnd: o.pageEnd }));
}
