"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, CircleHelp, Keyboard, LineChart, Plus, Trash2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { equationsEquivalent, equivalent, firstStepProblem, parsable } from "@/workspaces/math/logic";
import { newMathId, readMath, type MathPart, type MathWork } from "@/workspaces/math/model";
import type { WorkspaceProps } from "../types";
import { MathInput, insertInActiveField, toggleKeyboard } from "./math-input";
import { Plot } from "./plot";

// ─────────────────────────────────────────────────────────────────────────────
// Espace mathématique : éditeur visuel de formules, étapes de résolution par question, résultat final, graphique à la
// demande. Chaque étape est comparée à la précédente : on voit tout de suite où le raisonnement cesse d'être équivalent.
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE: { label: string; latex: string; title: string }[] = [
  { label: "a⁄b", latex: "\\frac{#@}{#?}", title: "Fraction" },
  { label: "√", latex: "\\sqrt{#?}", title: "Racine carrée" },
  { label: "xⁿ", latex: "#@^{#?}", title: "Puissance" },
  { label: "xₙ", latex: "#@_{#?}", title: "Indice" },
  { label: "Σ", latex: "\\sum_{#?}^{#?}#?", title: "Somme" },
  { label: "∫", latex: "\\int_{#?}^{#?}#?\\,\\mathrm{d}x", title: "Intégrale" },
  { label: "lim", latex: "\\lim_{#?\\to #?}#?", title: "Limite" },
  { label: "( )", latex: "\\left(#?\\right)", title: "Parenthèses" },
  { label: "|x|", latex: "\\left|#?\\right|", title: "Valeur absolue" },
  { label: "sin", latex: "\\sin\\left(#?\\right)", title: "Sinus" },
  { label: "cos", latex: "\\cos\\left(#?\\right)", title: "Cosinus" },
  { label: "ln", latex: "\\ln\\left(#?\\right)", title: "Logarithme népérien" },
  { label: "eˣ", latex: "e^{#?}", title: "Exponentielle" },
  { label: "π", latex: "\\pi", title: "Pi" },
  { label: "∞", latex: "\\infty", title: "Infini" },
  { label: "≤", latex: "\\le", title: "Inférieur ou égal" },
  { label: "≥", latex: "\\ge", title: "Supérieur ou égal" },
  { label: "≠", latex: "\\ne", title: "Différent" },
  { label: "×", latex: "\\times", title: "Multiplication" },
  { label: "÷", latex: "\\div", title: "Division" },
  { label: "matrice", latex: "\\begin{pmatrix}#? & #?\\\\ #? & #?\\end{pmatrix}", title: "Matrice 2×2" },
  { label: "système", latex: "\\begin{cases}#?\\\\ #?\\end{cases}", title: "Système d'équations" },
];

function Status({ prev, cur }: { prev: string; cur: string }) {
  if (!prev.trim() || !cur.trim()) return null;
  const both = prev.includes("=") && cur.includes("=");
  const none = !prev.includes("=") && !cur.includes("=");
  const ok = both ? equationsEquivalent(prev, cur) : none ? equivalent(prev, cur) : null;
  if (ok === true) return <span className="flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400" title="Équivalente à l'étape précédente"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> équivalente</span>;
  if (ok === false) return <span className="flex items-center gap-1 text-[11px] text-destructive" title="Cette étape n'est pas équivalente à la précédente"><XCircle className="h-3.5 w-3.5" aria-hidden /> à vérifier</span>;
  return <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Vérification impossible (expression non reconnue ou forme mixte)"><CircleHelp className="h-3.5 w-3.5" aria-hidden /> non vérifiable</span>;
}

export default function MathWorkspace({ value, onChange, disabled, payload }: WorkspaceProps) {
  const work = useMemo(() => readMath(value), [value]);
  const update = useCallback((fn: (w: MathWork) => MathWork) => onChange(fn(work)), [work, onChange]);
  const [partId, setPartId] = useState<string | null>(null);
  const part = work.parts.find((p) => p.id === partId) ?? work.parts[0];
  const wantsGraph = /graph|courbe|trac/i.test(((payload.deliverables as string[] | undefined) ?? []).join(" "));
  const [graphOpen, setGraphOpen] = useState(wantsGraph || !!work.graph?.functions.length);

  const patchPart = (f: (p: MathPart) => MathPart) => update((w) => ({ ...w, parts: w.parts.map((p) => (p.id === part.id ? f(p) : p)) }));
  const filled = part.steps.filter((s) => s.ascii.trim());
  const problem = firstStepProblem(filled);
  const graph = work.graph ?? { functions: [], xmin: -10, xmax: 10 };

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Questions" className="flex flex-wrap items-center gap-1">
        {work.parts.map((p, i) => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === part.id} onClick={() => setPartId(p.id)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", p.id === part.id ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted")}>{p.label || `Question ${i + 1}`}</button>
        ))}
        {!disabled && work.parts.length < 20 && <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => { const id = newMathId("p"); update((w) => ({ ...w, parts: [...w.parts, { id, label: `Question ${w.parts.length + 1}`, steps: [], result: { latex: "", ascii: "" } }] })); setPartId(id); }}><Plus className="h-3.5 w-3.5" aria-hidden /> Question</Button>}
        {!disabled && work.parts.length > 1 && <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => { update((w) => ({ ...w, parts: w.parts.filter((p) => p.id !== part.id) })); setPartId(null); }}><Trash2 className="h-3.5 w-3.5" aria-hidden /> Retirer</Button>}
      </div>

      {!disabled && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-muted/30 p-1.5" role="toolbar" aria-label="Palette de symboles et de structures">
          {PALETTE.map((p) => <button key={p.title} type="button" title={p.title} aria-label={p.title} onMouseDown={(e) => e.preventDefault()} onClick={() => insertInActiveField(p.latex)} className="min-w-8 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted">{p.label}</button>)}
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-xs" onClick={toggleKeyboard}><Keyboard className="h-3.5 w-3.5" aria-hidden /> Clavier</Button>
        </div>
      )}

      <ol className="space-y-2" aria-label={`Étapes de résolution — ${part.label || "question"}`}>
        {part.steps.map((s, i) => (
          <li key={s.id} className="rounded-xl border bg-card p-2">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <MathInput ariaLabel={`Étape ${i + 1}`} value={s.latex} disabled={disabled} placeholder="Écrivez votre calcul ou votre équation" onChange={(latex, ascii) => patchPart((p) => ({ ...p, steps: p.steps.map((x) => (x.id === s.id ? { ...x, latex, ascii } : x)) }))} />
                <div className="flex flex-wrap items-center gap-2">
                  <Input aria-label={`Commentaire de l'étape ${i + 1}`} className="h-7 min-w-40 flex-1 text-xs" placeholder="Commentaire (facultatif) : ce que vous faites" maxLength={500} value={s.note} disabled={disabled} onChange={(e) => patchPart((p) => ({ ...p, steps: p.steps.map((x) => (x.id === s.id ? { ...x, note: e.target.value } : x)) }))} />
                  {i > 0 ? <Status prev={part.steps[i - 1].ascii} cur={s.ascii} /> : s.ascii && !parsable(s.ascii) ? <span className="text-[11px] text-muted-foreground">expression non reconnue</span> : null}
                </div>
              </div>
              {!disabled && (
                <div className="flex flex-col">
                  <button type="button" aria-label="Monter l'étape" disabled={i === 0} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => patchPart((p) => { const a = [...p.steps]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return { ...p, steps: a }; })}><ArrowUp className="h-3.5 w-3.5" aria-hidden /></button>
                  <button type="button" aria-label="Descendre l'étape" disabled={i === part.steps.length - 1} className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30" onClick={() => patchPart((p) => { const a = [...p.steps]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return { ...p, steps: a }; })}><ArrowDown className="h-3.5 w-3.5" aria-hidden /></button>
                  <button type="button" aria-label="Supprimer l'étape" className="rounded p-0.5 text-muted-foreground hover:bg-muted" onClick={() => patchPart((p) => ({ ...p, steps: p.steps.filter((x) => x.id !== s.id) }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
      {!disabled && <Button type="button" size="sm" className="gap-1.5" disabled={part.steps.length >= 60} onClick={() => patchPart((p) => ({ ...p, steps: [...p.steps, { id: newMathId("s"), latex: "", ascii: "", note: "" }] }))}><Plus className="h-4 w-4" aria-hidden /> Ajouter une étape</Button>}
      {problem && <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{problem.message} {problem.kind === "calcul" ? "Reprenez ce calcul." : "Relisez la règle que vous avez appliquée."}</p>}

      <div className="rounded-xl border-2 border-primary/50 bg-primary/5 p-2">
        <p className="mb-1 text-xs font-semibold">Résultat final</p>
        <MathInput ariaLabel="Résultat final" value={part.result.latex} disabled={disabled} placeholder="Ex. x = 2" onChange={(latex, ascii) => patchPart((p) => ({ ...p, result: { latex, ascii } }))} />
      </div>

      <div className="rounded-xl border">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium" aria-expanded={graphOpen} onClick={() => setGraphOpen(!graphOpen)}><LineChart className="h-4 w-4" aria-hidden /> Graphique {graphOpen ? "" : <span className="text-xs font-normal text-muted-foreground">(à ouvrir si l&apos;exercice le demande)</span>}</button>
        {graphOpen && (
          <div className="space-y-2 border-t p-3">
            {graph.functions.map((f, i) => (
              <div key={f.id} className="flex items-center gap-2">
                <span className="text-xs font-medium">f<sub>{i + 1}</sub>(x) =</span>
                <div className="min-w-0 flex-1"><MathInput ariaLabel={`Fonction ${i + 1}`} value={f.latex} disabled={disabled} placeholder="x^2 - 3x + 1" onChange={(latex, ascii) => update((w) => ({ ...w, graph: { ...graph, functions: graph.functions.map((x) => (x.id === f.id ? { ...x, latex, ascii } : x)) } }))} /></div>
                {!disabled && <button type="button" aria-label="Retirer la fonction" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => update((w) => ({ ...w, graph: { ...graph, functions: graph.functions.filter((x) => x.id !== f.id) } }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {!disabled && <Button type="button" size="sm" variant="outline" className="gap-1.5" disabled={graph.functions.length >= 6} onClick={() => update((w) => ({ ...w, graph: { ...graph, functions: [...graph.functions, { id: newMathId("g"), latex: "", ascii: "" }] } }))}><Plus className="h-4 w-4" aria-hidden /> Fonction</Button>}
              <label className="flex items-center gap-1 text-xs">x de <Input aria-label="x minimum" type="number" className="h-7 w-20 text-xs" value={graph.xmin} disabled={disabled} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) update((w) => ({ ...w, graph: { ...graph, xmin: v } })); }} /></label>
              <label className="flex items-center gap-1 text-xs">à <Input aria-label="x maximum" type="number" className="h-7 w-20 text-xs" value={graph.xmax} disabled={disabled} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) update((w) => ({ ...w, graph: { ...graph, xmax: v } })); }} /></label>
            </div>
            {graph.functions.some((f) => parsable(f.ascii)) && graph.xmax > graph.xmin ? <Plot functions={graph.functions.filter((f) => parsable(f.ascii))} xmin={graph.xmin} xmax={graph.xmax} /> : <p className="typo-meta">Ajoutez une fonction (par exemple x^2 − 3x + 1) pour la voir tracée.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
