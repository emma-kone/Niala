// Découpage du texte extrait en passages indexables, avec page et décalages de caractères.
// Les décalages (charStart/charEnd) sont RELATIFS AU TEXTE DE LA PAGE (ou du document entier
// pour les formats sans pages) afin de pouvoir citer et surligner un passage précis.

export interface PageText {
  page: number | null;
  text: string;
}

export interface Passage {
  page: number | null;
  charStart: number;
  charEnd: number;
  content: string;
}

const PAGE_MARK = /^--- (?:Page|Diapositive) (\d+) ---$/m;

/** Sépare le texte produit par l'extraction en pages (repères « --- Page N --- »). */
export function splitPages(text: string): PageText[] {
  const parts = text.split(/^(--- (?:Page|Diapositive) \d+ ---)$/m);
  if (parts.length === 1) return [{ page: null, text: text.trim() }];
  const pages: PageText[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i].match(PAGE_MARK)?.[1] ?? NaN);
    pages.push({ page: Number.isFinite(n) ? n : null, text: (parts[i + 1] ?? "").trim() });
  }
  return pages;
}

export function chunkPages(pages: PageText[], maxChars = 1200, overlap = 150, maxPassages = 2000): Passage[] {
  const out: Passage[] = [];
  for (const { page, text } of pages) {
    if (text.replace(/\s/g, "").length < 20) continue;
    let start = 0;
    while (start < text.length && out.length < maxPassages) {
      let end = Math.min(text.length, start + maxChars);
      if (end < text.length) {
        // coupe à la fin d'une phrase ou d'une ligne si possible
        const window = text.slice(start, end);
        const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("? "), window.lastIndexOf("! "));
        if (cut > maxChars * 0.5) end = start + cut + 1;
      }
      const content = text.slice(start, end);
      if (content.replace(/\s/g, "").length >= 20) out.push({ page, charStart: start, charEnd: end, content });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  }
  return out;
}

export interface StoredChunk {
  idx: number;
  page: number | null;
  charStart: number;
  charEnd: number;
  content: string;
}

/**
 * Reconstitue le texte des pages à partir des passages indexés (qui se chevauchent).
 * Utilisé UNIQUEMENT comme repli d'affichage quand l'original n'est pas consultable,
 * et toujours présenté comme « texte extrait ».
 * Les passages sans décalages connus (reprise V1 : 0/0) sont simplement concaténés.
 */
export function stitchChunks(chunks: StoredChunk[]): PageText[] {
  const pages = new Map<number | null, StoredChunk[]>();
  for (const c of [...chunks].sort((a, b) => a.idx - b.idx)) {
    const list = pages.get(c.page) ?? [];
    list.push(c);
    pages.set(c.page, list);
  }
  const out: PageText[] = [];
  for (const [page, list] of pages) {
    let text = "";
    let covered = 0; // fin du texte déjà reconstitué, en décalage de page
    let hasOffsets = list.every((c) => c.charEnd > c.charStart);
    for (const c of list) {
      if (hasOffsets && c.charStart < covered) {
        text += c.content.slice(Math.min(covered - c.charStart, c.content.length));
      } else {
        text += (text && !hasOffsets ? "\n\n" : "") + c.content;
      }
      covered = Math.max(covered, c.charEnd);
    }
    out.push({ page, text });
  }
  return out.sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
}
