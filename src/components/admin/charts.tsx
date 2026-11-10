"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bucketLabel } from "@/components/admin/format";

// Graphiques interactifs (survol = valeur exacte). Les données arrivent déjà agrégées du serveur : rien n'est recalculé ici.

export const PALETTE = ["#8061b3", "#3b8fd0", "#e0a13a", "#3fa384", "#d9658b", "#7d8597", "#b8742c"];

type Bucket = "hour" | "day" | "week" | "month" | "quarter";
export interface SeriesDef { key: string; name: string; color?: string }

const tooltipStyle = { background: "var(--popover)", color: "var(--popover-foreground)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, boxShadow: "0 8px 24px rgb(0 0 0 / 0.12)" } as const;
// Les attributs SVG n'acceptent pas var(...) : le texte est coloré par une classe (thème clair/sombre), les traits par un gris neutre translucide.
const axis = { fontSize: 11 } as const;
const GRID = "rgba(128,128,128,0.28)";
const TEXT = "[&_.recharts-text]:fill-muted-foreground [&_.recharts-legend-item-text]:!text-foreground";

function Empty() {
  return <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">Pas encore de donnée sur cette période.</div>;
}

export function TimeChart({ data, series, kind = "line", bucket = "day", height = 240, suffix = "" }: { data: ({ bucket: string } & Record<string, number | string | null>)[]; series: SeriesDef[]; kind?: "line" | "bar" | "area"; bucket?: Bucket; height?: number; suffix?: string }) {
  const has = data.some((d) => series.some((s) => Number(d[s.key] ?? 0) > 0));
  // Un libellé déjà fourni (aperçu des rapports) est conservé tel quel ; sinon il est déduit de la date du point.
  const rows = data.map((d) => ({ ...d, label: typeof d.label === "string" ? d.label : bucketLabel(String(d.bucket), bucket) }));
  const common = { data: rows, margin: { top: 8, right: 8, bottom: 0, left: -8 } };
  const grid = <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />;
  const axes = (
    <>
      <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={24} />
      <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
      <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: GRID }} formatter={(v) => [`${v}${suffix}`, undefined]} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );
  return (
    <div style={{ height }} className={TEXT} role="img" aria-label={`Graphique : ${series.map((s) => s.name).join(", ")}`}>
      {!has ? <Empty /> : (
        <ResponsiveContainer width="100%" height="100%">
          {kind === "bar" ? (
            <BarChart {...common}>{grid}{axes}{series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color ?? PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} maxBarSize={36} />)}</BarChart>
          ) : kind === "area" ? (
            <AreaChart {...common}>{grid}{axes}{series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? PALETTE[i % PALETTE.length]} fill={s.color ?? PALETTE[i % PALETTE.length]} fillOpacity={0.15} strokeWidth={2} />)}</AreaChart>
          ) : (
            <LineChart {...common}>{grid}{axes}{series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2} dot={rows.length < 25} activeDot={{ r: 4 }} />)}</LineChart>
          )}
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function Donut({ data, height = 220 }: { data: { label: string; value: number }[]; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <div style={{ height }}><Empty /></div>;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div style={{ height, width: Math.min(height, 220) }} className={`shrink-0 ${TEXT}`} role="img" aria-label={`Répartition : ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="92%" paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${v} (${Math.round((Number(v) / total) * 100)} %)`, n]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-[160px] flex-1 space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} /><span className="truncate">{d.label}</span></span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{d.value} · {Math.round((d.value / total) * 100)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarsByCategory({ data, series, height = 260, horizontal }: { data: ({ label: string } & Record<string, number | string | null>)[]; series: SeriesDef[]; height?: number; horizontal?: boolean }) {
  const has = data.some((d) => series.some((s) => Number(d[s.key] ?? 0) > 0));
  return (
    <div style={{ height }} className={TEXT} role="img" aria-label={`Comparaison : ${series.map((s) => s.name).join(", ")}`}>
      {!has ? <Empty /> : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 12, bottom: 0, left: horizontal ? 24 : -8 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={!horizontal} vertical={!!horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={false} width={150} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
                <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              </>
            )}
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(128,128,128,0.15)" }} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color ?? PALETTE[i % PALETTE.length]} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={32} />)}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
