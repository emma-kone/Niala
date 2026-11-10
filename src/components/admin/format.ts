// Formats d'affichage du back-office (français, fuseau UTC = Abidjan).

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
export const fmtNumber = (v: number | null | undefined) => (v == null ? "—" : nf.format(v));

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(d)) : "—";

export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(d)) + " UTC" : "—";

export const fmtMs = (ms: number | null | undefined) => (ms == null ? "—" : ms >= 1000 ? `${nf.format(ms / 1000)} s` : `${Math.round(ms)} ms`);

export const fmtMinutes = (m: number | null | undefined) => (m == null ? "—" : m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")}` : `${Math.round(m)} min`);

export const fmtHours = (h: number | null | undefined) => (h == null ? "—" : h >= 48 ? `${nf.format(h / 24)} j` : `${nf.format(h)} h`);

export const fmtPercent = (v: number | null | undefined) => (v == null ? "—" : `${nf.format(v)} %`);

export const fmtBytes = (b: number) => (b >= 1_048_576 ? `${nf.format(b / 1_048_576)} Mo` : `${Math.max(1, Math.round(b / 1024))} Ko`);

/** Libellé court d'un point de série selon la granularité. */
export function bucketLabel(iso: string, bucket: "hour" | "day" | "week" | "month" | "quarter"): string {
  const d = new Date(iso);
  if (bucket === "hour") return `${String(d.getUTCHours()).padStart(2, "0")} h`;
  if (bucket === "month") return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(d);
  if (bucket === "quarter") return `T${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(d);
}

export const labelOf = <T extends string>(map: Record<T, string>, key: string | null | undefined) => (key && key in map ? map[key as T] : (key ?? "—"));
