// Recherche dans les passages d'un cours : règles pures (sans base ni réseau).
// Deux signaux complémentaires fusionnés par « reciprocal rank fusion » :
//  - lexical : mots de la question retrouvés dans le passage (fiable pour les termes exacts, sigles, noms) ;
//  - sémantique : similarité de vecteurs (retrouve les paraphrases).

const STOPWORDS = new Set(
  ("le la les un une des du de d l et ou en au aux a à est sont ce cet cette ces que qui quoi dont où pour par sur sous dans avec sans ne pas plus se sa son ses leur leurs il elle ils elles on nous vous je tu " +
    "mon ma mes ton ta tes qu comme mais donc car si the of and to in is are what how why which pourquoi comment quel quelle quels quelles peux peut expliquer explique dis moi cours document fichier chapitre " +
    "ai as avez etre fait faire cela ceci ca").split(/\s+/)
);

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Mots significatifs de la question (sans accents, sans mots vides, max 8). */
export function queryTerms(question: string, max = 8): string[] {
  const seen = new Set<string>();
  for (const raw of fold(question).split(/[^a-z0-9#+]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Score lexical : occurrences (amorties) pondérées par la longueur du terme, bonus si plusieurs termes distincts. */
export function lexicalScore(content: string, terms: string[]): number {
  if (!terms.length) return 0;
  const text = fold(content);
  let score = 0;
  let distinct = 0;
  for (const t of terms) {
    let count = 0;
    for (let i = text.indexOf(t); i !== -1 && count < 20; i = text.indexOf(t, i + t.length)) count++;
    if (count) {
      distinct++;
      score += (1 + Math.log(count)) * Math.min(2, t.length / 4);
    }
  }
  return score * (1 + distinct / terms.length);
}

/** Produit scalaire (les vecteurs sont normalisés : équivaut à la similarité cosinus). */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Fusion de classements (identifiants du meilleur au moins bon) : score = Σ 1/(k+rang). */
export function fuseRankings(rankings: string[][], k = 60): Map<string, number> {
  const out = new Map<string, number>();
  for (const ranking of rankings) ranking.forEach((id, i) => out.set(id, (out.get(id) ?? 0) + 1 / (k + i + 1)));
  return out;
}

export interface Coverage {
  pageCount: number | null;
  pagesWithText: number;
  emptyPages: number[];
  indexedPassages: number;
  embeddedPassages: number;
  /** Vrai seulement si chaque page du document a du texte extrait. */
  complete: boolean;
  /** Vecteurs sémantiques disponibles pour tous les passages (information technique, jamais montrée à l'étudiant). */
  semanticComplete: boolean;
  warnings: string[];
}

/** Ce que l'IA peut honnêtement affirmer avoir « lu » : calculé, jamais déclaré par le modèle. */
export function computeCoverage(input: {
  pageCount: number | null;
  pages: (number | null)[]; // page de chaque passage indexé
  embeddedPassages: number;
  extractWarnings: string[];
  extractStatus: string;
}): Coverage {
  const withText = new Set(input.pages.filter((p): p is number => p != null));
  const pageless = input.pages.length > 0 && input.pages.every((p) => p == null);
  const empty: number[] = [];
  if (input.pageCount && !pageless) for (let p = 1; p <= input.pageCount; p++) if (!withText.has(p)) empty.push(p);
  const warnings = [...input.extractWarnings];
  if (input.pages.length === 0) warnings.push("Aucun texte n'a pu être extrait de ce document.");
  else if (empty.length) warnings.push(`${empty.length} page(s) sans texte extrait (scannées ou composées d'images) : ${empty.slice(0, 12).join(", ")}${empty.length > 12 ? "…" : ""}.`);
  return {
    pageCount: input.pageCount,
    pagesWithText: pageless ? 0 : withText.size,
    emptyPages: empty,
    indexedPassages: input.pages.length,
    embeddedPassages: input.embeddedPassages,
    complete: input.pages.length > 0 && empty.length === 0 && input.extractStatus === "READY",
    semanticComplete: input.pages.length > 0 && input.embeddedPassages >= input.pages.length,
    warnings,
  };
}

export interface Citation {
  n: number;
  documentId: string;
  documentName: string;
  subjectId: string | null;
  versionId: string;
  page: number | null;
  section: string | null;
  quote: string;
  /** Absent = passage d'un cours. « web » : source externe (documentName = titre, url renseignée). */
  kind?: "document" | "web";
  url?: string;
  tier?: "reconnue" | "a_verifier";
}

/**
 * Valide les marqueurs [n] d'une réponse : seuls ceux qui correspondent à un passage RÉELLEMENT consulté
 * sont conservés (les autres sont retirés du texte). Renvoie le texte nettoyé et les citations utilisées.
 */
export function resolveCitations(answer: string, known: Map<number, Citation>): { text: string; citations: Citation[] } {
  const used = new Map<number, Citation>();
  const text = answer
    .replace(/\[(\d{1,3}(?:\s*[,;]\s*\d{1,3})*)\]/g, (_whole, list: string) => {
      const kept = list
        .split(/[,;]/)
        .map((x) => Number(x.trim()))
        .filter((n) => known.has(n));
      kept.forEach((n) => used.set(n, known.get(n)!));
      return kept.length ? `[${kept.join(", ")}]` : "";
    })
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/ {2,}/g, " ");
  return { text, citations: [...used.values()].sort((a, b) => a.n - b.n) };
}
