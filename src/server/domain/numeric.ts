// Validation NUMÉRIQUE des réponses de calcul : comparaison de valeurs, jamais de chaînes.
// Accepte virgule décimale, espaces de milliers, fractions, pourcentages, notation scientifique et unités collées.
// L'analyse de l'écart (signe, puissance de dix, ±1, pourcentage) ne sert qu'à EXPLIQUER une erreur : c'est un constat
// sur les valeurs, pas un jugement sur l'étudiant.

export interface ParsedNumber {
  value: number;
  /** Nombre de décimales écrites par l'étudiant (pour juger d'un arrondi). */
  decimals: number;
  percent: boolean;
  /** Unité écrite à la suite du nombre (cm, kg, €…), en minuscules ; absente si aucune. */
  unit?: string;
}

const UNIT = /\s*[a-zA-Zµ°²³/%€$]+(?:\/[a-zA-Z]+)?\s*$/;

export function parseNumber(raw: string): ParsedNumber | null {
  let s = String(raw).trim().replace(/^[a-zA-Z]\s*=\s*/, "").replace(/−/g, "-").replace(/ | /g, " ");
  if (!s) return null;
  let percent = false;
  let unit: string | undefined;
  if (/%$/.test(s)) {
    percent = true;
    s = s.replace(/\s*%$/, "");
  } else {
    s = s.replace(UNIT, (m) => {
      if (/^\s*[eE]\d/.test(m)) return m;
      unit = m.trim().toLowerCase();
      return "";
    });
  }
  s = s.trim();
  const frac = /^(-?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)$/.exec(s);
  if (frac) {
    const d = Number(frac[2].replace(",", "."));
    if (d === 0) return null;
    return { value: Number(frac[1].replace(",", ".")) / d, decimals: 12, percent, unit };
  }
  // 1 234,56 · 1.234,56 · 1,234.56 · 1234.56
  s = s.replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s) && !/^-?\d\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(",", ".");
  if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  const decimals = /e/i.test(s) ? 12 : (s.split(".")[1] ?? "").length;
  return { value: percent ? value / 100 : value, decimals, percent, unit };
}

export type NumericRelation = "equal" | "rounded" | "opposite" | "power_of_ten" | "off_by_one" | "different";

const close = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= Math.max(1e-12, rel * Math.max(Math.abs(a), Math.abs(b)));

/** Compare la réponse donnée à une valeur attendue. « rounded » : même valeur arrondie à la précision écrite (au moins 2 décimales). */
export function compareNumeric(given: ParsedNumber, expected: ParsedNumber): NumericRelation {
  const g = given.value;
  const e = expected.value;
  // Deux unités écrites et différentes : la valeur ne suffit pas (12 m ≠ 12 cm)
  if (given.unit && expected.unit && given.unit !== expected.unit) return "different";
  if (close(g, e)) return "equal";
  if (given.decimals >= 2 && given.decimals < 12) {
    const f = 10 ** given.decimals;
    if (Math.round(e * f) / f === Math.round(g * f) / f && Math.abs(g - e) <= 0.5 / f + 1e-12) return "rounded";
  }
  if (e !== 0 && close(g, -e, 1e-6)) return "opposite";
  if (e !== 0 && g !== 0) {
    const ratio = Math.abs(g / e);
    for (const k of [10, 100, 1000, 0.1, 0.01, 0.001]) if (close(ratio, k, 1e-6)) return "power_of_ten";
  }
  if (Number.isInteger(e) && Number.isInteger(g) && Math.abs(g - e) === 1) return "off_by_one";
  return "different";
}

export const RELATION_TEXT: Record<Exclude<NumericRelation, "equal" | "rounded" | "different">, string> = {
  opposite: "Votre résultat est l'opposé du résultat attendu (même valeur, signe contraire).",
  power_of_ten: "Votre résultat diffère du résultat attendu d'un facteur 10, 100 ou 1000 (virgule, unité, pourcentage ou conversion).",
  off_by_one: "Votre résultat est décalé d'une unité par rapport au résultat attendu.",
};

/** Meilleure relation entre la réponse et la liste des valeurs acceptées (null si elles ne sont pas numériques). */
export function bestNumericRelation(givenRaw: string, accepted: string[]): { relation: NumericRelation; expected: number } | null {
  const given = parseNumber(givenRaw);
  const exp = accepted.map(parseNumber);
  if (!given || exp.length === 0 || exp.some((x) => x === null)) return null;
  const order: NumericRelation[] = ["equal", "rounded", "opposite", "power_of_ten", "off_by_one", "different"];
  let best: { relation: NumericRelation; expected: number } | null = null;
  for (const e of exp as ParsedNumber[]) {
    const relation = compareNumeric(given, e);
    if (!best || order.indexOf(relation) < order.indexOf(best.relation)) best = { relation, expected: e.value };
  }
  return best;
}
