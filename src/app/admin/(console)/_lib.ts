import { resolvePeriod } from "@/server/admin/stats/common";

export type SP = Promise<Record<string, string | string[] | undefined>>;

/** Premier exemplaire de chaque paramètre d'URL. */
export async function flat(sp: SP): Promise<Record<string, string | undefined>> {
  const raw = await sp;
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
}

export async function periodOf(sp: SP) {
  const q = await flat(sp);
  return { q, period: resolvePeriod({ p: q.p, from: q.from, to: q.to }) };
}

export const iso = (d: Date) => d.toISOString();

/** Série {bucket, value} → lignes de graphique. */
export const rows = <T extends { bucket: Date }>(points: T[], map: (p: T) => Record<string, number | null>) => points.map((p) => ({ bucket: iso(p.bucket), ...map(p) }));

/** Conserve les paramètres d'URL utiles (hors page) pour les liens de tri et de pagination. */
export function keep(q: Record<string, string | undefined>, drop: string[] = ["page"]) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "" && !drop.includes(k)) out.set(k, v);
  return out;
}
