/** Extrait un objet JSON d'une réponse LLM (tolère les blocs ```json). */
export function parseJsonLoose<T>(raw: string): T | null {
  return (parseJsonDetailed<T>(raw)?.value ?? null) as T | null;
}

export interface ParsedJson<T> {
  value: T;
  /** Le texte n'était pas un JSON valide tel quel : il a été réparé (échappements, virgules, fin manquante). */
  repaired: boolean;
  /** La réponse s'arrêtait avant la fin : seule la partie complète a été conservée. */
  truncated: boolean;
}

/**
 * Lecture tolérante d'une réponse de modèle. D'abord le JSON tel quel ; sinon une réparation des défauts que les modèles
 * produisent réellement : barre oblique inverse non doublée (formules LaTeX, chemins, expressions régulières), saut de
 * ligne brut dans une chaîne, virgule finale, réponse coupée par la limite de longueur. Le résultat reste soumis au
 * schéma de l'appelant : une réparation ne rend jamais valide un contenu qui ne l'est pas.
 */
export function parseJsonDetailed<T>(raw: string): ParsedJson<T> | null {
  const cleaned = raw
    .replace(/```json\s*/gi, "```")
    .split("```")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = [raw, ...cleaned];
  for (const c of candidates) {
    const start = Math.min(...[c.indexOf("{"), c.indexOf("[")].filter((i) => i >= 0).concat([Number.MAX_SAFE_INTEGER]));
    if (start === Number.MAX_SAFE_INTEGER) continue;
    const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
    if (end <= start) continue;
    try {
      return { value: JSON.parse(c.slice(start, end + 1)) as T, repaired: false, truncated: false };
    } catch {
      continue;
    }
  }
  for (const c of candidates) {
    const fixed = repairJson(c);
    if (!fixed) continue;
    try {
      return { value: JSON.parse(fixed.text) as T, repaired: true, truncated: fixed.truncated };
    } catch {
      continue;
    }
  }
  return null;
}

const VALID_ESCAPES = '"\\/bfnrt';

/**
 * Réécrit un JSON abîmé en JSON valide, sans en inventer le contenu. Une réponse coupée est ramenée à son dernier
 * élément complet puis refermée. Renvoie null si le texte ne contient pas de structure JSON ou si elle est incohérente.
 */
export function repairJson(raw: string): { text: string; truncated: boolean } | null {
  const start = Math.min(...[raw.indexOf("{"), raw.indexOf("[")].filter((i) => i >= 0).concat([Number.MAX_SAFE_INTEGER]));
  if (start === Number.MAX_SAFE_INTEGER) return null;
  let out = "";
  const stack: string[] = [];
  let inString = false;
  // Dernier point où le texte produit, une fois refermé, est un JSON complet SANS élément partiel : dans un tableau
  // (entre deux éléments) ou dans l'objet racine (entre deux propriétés). Un objet imbriqué inachevé est abandonné en
  // entier : une question sans tous ses champs ne vaut pas mieux que pas de question.
  let safe: { length: number; depth: number } | null = null;
  const mark = (length: number) => {
    if (stack.length === 1 || stack[stack.length - 1] === "]") safe = { length, depth: stack.length };
  };
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (ch === "\\") {
        const next = raw[i + 1];
        if (next === undefined) break;
        if (VALID_ESCAPES.includes(next)) {
          out += ch + next;
          i++;
        } else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6))) {
          out += raw.slice(i, i + 6);
          i += 5;
        } else {
          out += "\\\\"; // « \( », « \sqrt », « \d » : la barre est doublée, le caractère suivant est lu normalement
        }
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (ch >= " ") out += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
      out += ch;
      mark(out.length);
    } else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] !== ch) return null;
      out = out.replace(/,\s*$/, "") + ch;
      stack.pop();
      if (!stack.length) return { text: out, truncated: false };
      mark(out.length);
    } else if (ch === ",") {
      mark(out.length);
      out += ch;
    } else {
      out += ch;
    }
  }
  const cut = safe as { length: number; depth: number } | null;
  if (!cut) return null;
  return { text: out.slice(0, cut.length) + stack.slice(0, cut.depth).reverse().join(""), truncated: true };
}
