// ─────────────────────────────────────────────────────────────────────────────
// Grille « semaines en colonnes » d'un PDF : relevé déterministe de la position de chaque cellule.
// Un modèle de vision décale facilement les colonnes quand une cellule vide tombe au milieu d'une ligne ;
// ici, une cellule appartient à une semaine parce qu'elle se trouve physiquement sous sa colonne.
// ─────────────────────────────────────────────────────────────────────────────

export interface TextItem {
  x: number;
  y: number;
  w: number;
  s: string;
}

export interface LayoutCell {
  day: number;
  start: number;
  end: number;
  week: number;
  text: string;
}

export interface PdfLayout {
  weeks: { numero: number; debut: string }[];
  slots: { day: number; start: number; end: number }[];
  cells: LayoutCell[];
  /** Le même relevé, lisible par le modèle. */
  text: string;
}

const DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const SLOT = /^(\d{1,2})h(\d{2})?\s*-\s*(\d{1,2})h(\d{2})?$/i;
const DAY_NAMES = ["LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE"];
const ROW_TOLERANCE = 3;
/** Au-delà, un texte n'appartient plus à la ligne horaire la plus proche (légende sous la grille, par exemple). */
const SLOT_TOLERANCE = 16;

const center = (i: TextItem) => i.x + i.w / 2;
const minutes = (h: string, m?: string) => Number(h) * 60 + Number(m ?? 0);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function layoutFromItems(items: TextItem[]): PdfLayout | null {
  const dates = items.filter((i) => DATE.test(i.s.trim()));
  // La ligne d'en-tête est celle qui porte le plus de dates.
  const headerY = dates.map((d) => d.y).sort((a, b) => dates.filter((d) => Math.abs(d.y - b) <= ROW_TOLERANCE).length - dates.filter((d) => Math.abs(d.y - a) <= ROW_TOLERANCE).length)[0];
  if (headerY === undefined) return null;
  const header = dates.filter((d) => Math.abs(d.y - headerY) <= ROW_TOLERANCE).sort((a, b) => a.x - b.x);
  if (header.length < 4) return null;

  const columns = header.map(center);
  const half = ((columns[columns.length - 1] - columns[0]) / (columns.length - 1) / 2) * 1.05;
  const weeks = header.map((d, i) => {
    const [, dd, mm, yyyy] = DATE.exec(d.s.trim())!;
    return { numero: i + 1, debut: `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}` };
  });
  const body = items.filter((i) => i.y < headerY - ROW_TOLERANCE);
  const inMargin = (i: TextItem) => center(i) < columns[0] - half;

  // Lignes horaires : une nouvelle journée commence quand l'heure de début revient en arrière.
  const labels = body.filter((i) => inMargin(i) && SLOT.test(i.s.trim())).sort((a, b) => b.y - a.y).map((i) => {
    const [, h1, m1, h2, m2] = SLOT.exec(i.s.trim())!;
    return { y: i.y, start: minutes(h1, m1), end: minutes(h2, m2) };
  });
  if (!labels.length) return null;
  const groups: (typeof labels)[] = [];
  for (const l of labels) {
    const current = groups[groups.length - 1];
    if (current && l.start > current[current.length - 1].start) current.push(l);
    else groups.push([l]);
  }
  const dayLabels = body.filter((i) => inMargin(i) && DAY_NAMES.includes(i.s.trim().toUpperCase())).map((i) => ({ y: i.y, day: DAY_NAMES.indexOf(i.s.trim().toUpperCase()) + 1 }));
  if (!dayLabels.length) return null;
  const rows = groups.flatMap((g) => {
    const mid = (g[0].y + g[g.length - 1].y) / 2;
    const { day } = dayLabels.reduce((best, d) => (Math.abs(d.y - mid) < Math.abs(best.y - mid) ? d : best));
    return g.map((l) => ({ ...l, day }));
  });

  // Les lettres isolées forment les textes verticaux des cellules fusionnées : ce ne sont pas des cours.
  const buckets = new Map<string, { day: number; start: number; end: number; week: number; parts: TextItem[] }>();
  const vertical = new Map<number, TextItem[]>();
  for (const item of body) {
    if (inMargin(item) || !item.s.trim()) continue;
    const col = columns.findIndex((c) => Math.abs(c - center(item)) <= half);
    if (col < 0) continue;
    if (item.s.trim().length === 1) {
      vertical.set(col, [...(vertical.get(col) ?? []), item]);
      continue;
    }
    const row = rows.reduce((best, r) => (Math.abs(r.y - item.y) < Math.abs(best.y - item.y) ? r : best));
    if (Math.abs(row.y - item.y) > SLOT_TOLERANCE) continue;
    const key = `${row.day}:${row.start}:${col}`;
    const bucket = buckets.get(key) ?? { day: row.day, start: row.start, end: row.end, week: col + 1, parts: [] };
    bucket.parts.push(item);
    buckets.set(key, bucket);
  }
  const cells = [...buckets.values()].map(({ parts, ...c }) => ({ ...c, text: parts.sort((a, b) => b.y - a.y || a.x - b.x).map((p) => p.s.trim()).join(" ") }));

  const lines = rows.map((r) => {
    const content = weeks.map((w) => `S${w.numero}: ${cells.find((c) => c.day === r.day && c.start === r.start && c.week === w.numero)?.text ?? "(vide)"}`);
    return `${DAY_NAMES[r.day - 1]} ${hm(r.start)}-${hm(r.end)} | ${content.join(" | ")}`;
  });
  const merged = [...vertical].sort((a, b) => a[0] - b[0]).map(([col, letters]) => `S${col + 1} (${weeks[col].debut}) : texte vertical sur toute la colonne : ${letters.sort((a, b) => b.y - a.y || a.x - b.x).map((l) => l.s.trim()).join("")}`);
  return {
    weeks,
    slots: rows.map(({ day, start, end }) => ({ day, start, end })),
    cells,
    text: [`Semaines : ${weeks.map((w) => `S${w.numero} = ${w.debut}`).join(", ")}`, ...lines, ...merged].join("\n"),
  };
}

export async function pdfLayout(bytes: Buffer): Promise<PdfLayout | null> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
    const { items } = await (await doc.getPage(n)).getTextContent();
    const layout = layoutFromItems(items.flatMap((i) => ("str" in i ? [{ x: i.transform[4], y: i.transform[5], w: i.width, s: i.str }] : [])));
    if (layout) return layout;
  }
  return null;
}
