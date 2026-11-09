"use client";

import { useMemo } from "react";
import { sampleFunction } from "@/workspaces/math/logic";

const COLORS = ["#6e51a1", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6"];

/** Courbes de fonctions : axes, graduations, coupure aux points non définis. */
export function Plot({ functions, xmin, xmax }: { functions: { id: string; ascii: string }[]; xmin: number; xmax: number }) {
  const W = 560;
  const H = 320;
  const data = useMemo(() => functions.map((f) => ({ id: f.id, pts: sampleFunction(f.ascii, xmin, xmax, 500) })), [functions, xmin, xmax]);
  const ys = data.flatMap((d) => d.pts.map((p) => p.y).filter((y): y is number => y !== null));
  let ymin = ys.length ? Math.min(...ys) : -5;
  let ymax = ys.length ? Math.max(...ys) : 5;
  // Les asymptotes ne doivent pas écraser le graphique : on borne autour de la médiane des valeurs.
  if (ys.length > 10) {
    const sorted = [...ys].sort((a, b) => a - b);
    ymin = Math.max(ymin, sorted[Math.floor(sorted.length * 0.02)] - 1);
    ymax = Math.min(ymax, sorted[Math.floor(sorted.length * 0.98)] + 1);
  }
  if (!(ymax > ymin)) [ymin, ymax] = [ymin - 1, ymax + 1];
  const pad = (ymax - ymin) * 0.08;
  ymin -= pad;
  ymax += pad;
  const sx = (x: number) => ((x - xmin) / (xmax - xmin)) * W;
  const sy = (y: number) => H - ((y - ymin) / (ymax - ymin)) * H;
  const tick = (a: number, b: number) => {
    const raw = (b - a) / 8;
    const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
    const out: number[] = [];
    for (let v = Math.ceil(a / step) * step; v <= b; v += step) out.push(Math.round(v / step) * step);
    return out;
  };
  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

  return (
    <svg viewBox={`-30 -10 ${W + 50} ${H + 30}`} role="img" aria-label="Représentation graphique des fonctions" className="w-full max-w-2xl rounded-xl border bg-card">
      {tick(xmin, xmax).map((v) => (
        <g key={`x${v}`}><line x1={sx(v)} x2={sx(v)} y1={0} y2={H} className="stroke-border" strokeWidth="0.6" /><text x={sx(v)} y={H + 12} textAnchor="middle" fontSize="9" className="fill-muted-foreground">{fmt(v)}</text></g>
      ))}
      {tick(ymin, ymax).map((v) => (
        <g key={`y${v}`}><line y1={sy(v)} y2={sy(v)} x1={0} x2={W} className="stroke-border" strokeWidth="0.6" /><text x={-4} y={sy(v) + 3} textAnchor="end" fontSize="9" className="fill-muted-foreground">{fmt(v)}</text></g>
      ))}
      {xmin < 0 && xmax > 0 && <line x1={sx(0)} x2={sx(0)} y1={0} y2={H} className="stroke-foreground" strokeWidth="1" />}
      {ymin < 0 && ymax > 0 && <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} className="stroke-foreground" strokeWidth="1" />}
      {data.map((d, i) => {
        const segments: string[] = [];
        let cur = "";
        for (const p of d.pts) {
          if (p.y === null || p.y < ymin - (ymax - ymin) || p.y > ymax + (ymax - ymin)) {
            if (cur) segments.push(cur);
            cur = "";
          } else cur += `${cur ? "L" : "M"}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`;
        }
        if (cur) segments.push(cur);
        return segments.map((s, k) => <path key={`${d.id}-${k}`} d={s} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="1.8" />);
      })}
    </svg>
  );
}
