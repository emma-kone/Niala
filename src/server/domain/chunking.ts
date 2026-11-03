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
