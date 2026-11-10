import Link from "next/link";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtNumber } from "@/components/admin/format";
import type { Kpi } from "@/server/admin/stats/overview";

// Briques d'affichage communes aux rubriques du back-office (composants serveur, sans état).

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, description, action, children, className }: { title?: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warn"; children: React.ReactNode; className?: string }) {
  const Icon = tone === "warn" ? AlertTriangle : Info;
  return (
    <div role="note" className={cn("flex gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm", tone === "warn" ? "border-amber-500/40 bg-amber-500/10" : "border-[var(--niala-accent)]/30 bg-[var(--niala-accent)]/8", className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 max-w-md text-xs text-muted-foreground">{children}</p>}
    </div>
  );
}

/** Évolution par rapport à la période précédente. « n/d » quand rien ne permet de la calculer : jamais de pourcentage inventé. */
export function Delta({ change, invert }: { change: number | null; invert?: boolean }) {
  if (change == null) return <span className="text-xs text-muted-foreground" title="Pas de donnée sur la période précédente : aucune évolution n'est calculée.">Évolution n/d</span>;
  const up = change > 0;
  const good = change === 0 ? null : invert ? !up : up;
  const Icon = change === 0 ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium", good == null ? "bg-muted text-muted-foreground" : good ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/15 text-rose-700 dark:text-rose-300")}>
      <Icon className="h-3 w-3" aria-hidden />
      {change > 0 ? "+" : ""}
      {fmtNumber(change)} %
    </span>
  );
}

export function KpiCard({ kpi, invert }: { kpi: Kpi; invert?: boolean }) {
  const value = kpi.value == null ? "—" : `${fmtNumber(kpi.value)}${kpi.unit === "%" ? " %" : kpi.unit === "min" ? " min" : ""}`;
  return (
    <div className="flex flex-col justify-between rounded-2xl border bg-card p-4 shadow-sm" title={kpi.hint}>
      <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Delta change={kpi.change} invert={invert} />
        {kpi.previous != null && <span className="text-[11px] text-muted-foreground">avant : {fmtNumber(kpi.previous)}{kpi.unit === "%" ? " %" : ""}</span>}
      </div>
      <p className="mt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/80">{kpi.source === "table" ? "Mesuré · historique complet" : "Mesuré · collecte en direct"}</p>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "warn" | "good" }) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "warn" && "text-rose-600 dark:text-rose-300", tone === "good" && "text-emerald-600 dark:text-emerald-300")}>{value}</p>
    </div>
  );
}

const TONES: Record<string, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  warn: "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  bad: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  accent: "bg-[var(--niala-accent)]/15 text-[var(--niala-accent)]",
};

export function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof TONES }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", TONES[tone])}>{children}</span>;
}

export const statusTone = (s: string) => ({ RECEIVED: "info", PENDING_REVIEW: "warn", IN_PROGRESS: "accent", NEEDS_INFO: "warn", RESOLVED: "good", REJECTED: "neutral", ACTIVE: "good", SUSPENDED: "warn", DISABLED: "bad", OPEN: "bad", TO_STUDY: "neutral", PLANNED: "info", IN_DEV: "accent", DEPLOYED: "good", SUCCESS: "good", FAILED: "bad", DENIED: "bad", WARNING: "warn", CRITICAL: "bad" })[s] ?? "neutral";
export const priorityTone = (p: string) => ({ LOW: "neutral", NORMAL: "info", HIGH: "warn", URGENT: "bad" })[p] ?? "neutral";

/** Tableau de données simple : l'en-tête peut être un lien de tri. */
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ children, className, align }: { children?: React.ReactNode; className?: string; align?: "right" }) => (
  <th scope="col" className={cn("whitespace-nowrap border-b bg-muted/50 px-3 py-2 text-left text-xs font-semibold text-muted-foreground", align === "right" && "text-right", className)}>{children}</th>
);
export const Td = ({ children, className, align }: { children?: React.ReactNode; className?: string; align?: "right" }) => (
  <td className={cn("border-b px-3 py-2 align-middle last:border-b-0", align === "right" && "text-right tabular-nums", className)}>{children}</td>
);

export function SortHeader({ label, field, current, dir, base }: { label: string; field: string; current: string; dir: "asc" | "desc"; base: URLSearchParams }) {
  const next = new URLSearchParams(base);
  next.set("sort", field);
  next.set("dir", current === field && dir === "desc" ? "asc" : "desc");
  next.delete("page");
  return (
    <Th>
      <Link href={`?${next.toString()}`} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Trier par ${label}`}>
        {label}
        {current === field && <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span>}
      </Link>
    </Th>
  );
}

export function Pagination({ page, pages, total, base, size }: { page: number; pages: number; total: number; base: URLSearchParams; size: number }) {
  const href = (p: number) => {
    const q = new URLSearchParams(base);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };
  const from = total ? (page - 1) * size + 1 : 0;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{total ? `${from}–${Math.min(total, page * size)} sur ${fmtNumber(total)}` : "Aucun résultat"}</span>
      <div className="flex gap-1.5">
        {page > 1 ? <Link className="rounded-lg border px-2.5 py-1 hover:bg-muted" href={href(page - 1)}>Précédent</Link> : <span className="rounded-lg border px-2.5 py-1 opacity-40">Précédent</span>}
        <span className="px-2 py-1">Page {page} / {pages}</span>
        {page < pages ? <Link className="rounded-lg border px-2.5 py-1 hover:bg-muted" href={href(page + 1)}>Suivant</Link> : <span className="rounded-lg border px-2.5 py-1 opacity-40">Suivant</span>}
      </div>
    </div>
  );
}

/** Carte de chaleur jour × heure. L'intensité est relative au maximum observé ; chaque case a un libellé lisible. */
export function Heatmap({ cells, max, days, unit }: { cells: number[][]; max: number; days: string[]; unit: string }) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]" role="table" aria-label="Activité par jour et par heure">
        <div className="ml-24 grid grid-cols-24 text-[10px] text-muted-foreground" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }} role="row">
          {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center" role="columnheader">{h % 3 === 0 ? `${h}h` : ""}</span>)}
        </div>
        {cells.map((row, d) => (
          <div key={d} className="mt-1 flex items-center" role="row">
            <span className="w-24 shrink-0 pr-2 text-xs text-muted-foreground" role="rowheader">{days[d]}</span>
            <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
              {row.map((v, h) => {
                const a = max ? v / max : 0;
                return (
                  <div
                    key={h}
                    role="cell"
                    title={`${days[d]}, ${h} h – ${h + 1} h : ${v} ${unit}`}
                    aria-label={`${days[d]} ${h} h : ${v} ${unit}`}
                    className="aspect-square min-h-[14px] rounded-[4px] border border-border/40"
                    style={{ background: v ? `color-mix(in oklab, var(--niala-accent) ${Math.round(12 + a * 88)}%, transparent)` : "transparent" }}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="ml-24 mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Moins</span>
          {[0.1, 0.3, 0.55, 0.8, 1].map((a) => <span key={a} className="h-3 w-6 rounded-[3px]" style={{ background: `color-mix(in oklab, var(--niala-accent) ${Math.round(12 + a * 88)}%, transparent)` }} />)}
          <span>Plus (max {fmtNumber(max)} {unit})</span>
        </div>
      </div>
    </div>
  );
}

export function BarList({ items, suffix = "", max }: { items: { label: string; value: number; sub?: string }[]; suffix?: string; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <EmptyState title="Aucune donnée sur cette période." />;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{i.label}</span>
            <span className="shrink-0 tabular-nums font-medium">{fmtNumber(i.value)}{suffix}{i.sub && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{i.sub}</span>}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--niala-accent)]" style={{ width: `${Math.max(2, (i.value / top) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
