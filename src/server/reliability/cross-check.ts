import { foldText } from "@/server/ai/guard";

// ─────────────────────────────────────────────────────────────────────────────
// Recoupement : plusieurs pages ne valent plusieurs confirmations que si elles sont indépendantes.
// Deux pages du même organisme, ou deux pages qui reprennent le même texte, comptent pour une seule.
// ─────────────────────────────────────────────────────────────────────────────

const MULTI_PART_SUFFIX = /\.(gouv|gov|ac|edu|co|com|org|or|ne)\.[a-z]{2}$/;

/** Organisme derrière un nom de domaine (dernier niveau enregistrable). */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  const keep = MULTI_PART_SUFFIX.test(`.${parts.slice(-2).join(".")}`) ? 3 : 2;
  return parts.slice(-keep).join(".");
}

function shingles(text: string, size = 4): Set<string> {
  const words = foldText(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

/** Part du texte le plus court qui se retrouve dans l'autre (de 0 à 1). */
export function textOverlap(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / Math.min(sa.size, sb.size);
}

const COPY_THRESHOLD = 0.6;

export interface ComparableSource {
  n: number;
  host?: string;
  text: string;
}

/** Regroupe les sources qui ne sont pas indépendantes. Le nombre de groupes est le nombre de confirmations réelles. */
export function independentGroups(sources: ComparableSource[]): number[][] {
  const parent = new Map(sources.map((s) => [s.n, s.n]));
  const find = (n: number): number => {
    const p = parent.get(n)!;
    if (p === n) return n;
    const root = find(p);
    parent.set(n, root);
    return root;
  };
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i];
      const b = sources[j];
      const sameOrganization = !!a.host && !!b.host && registrableDomain(a.host) === registrableDomain(b.host);
      if (sameOrganization || textOverlap(a.text, b.text) >= COPY_THRESHOLD) parent.set(find(a.n), find(b.n));
    }
  }
  const groups = new Map<number, number[]>();
  for (const s of sources) {
    const root = find(s.n);
    groups.set(root, [...(groups.get(root) ?? []), s.n]);
  }
  return [...groups.values()];
}
