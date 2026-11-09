"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Info, Loader2, Play, Plus, Search, Sparkles, Trash2, Wand2, XCircle } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { candidateKeys, dictionaryIssues, dictionaryToCsv, fold, meriseIssues, mcdToMld, mldToMpd, mpdToSql, type Issue } from "@/workspaces/merise/logic";
import { DATA_TYPES, DATA_TYPE_LABEL, MCT_KINDS, newId, readMerise, type Dependency, type DictionaryItem, type MeriseWork, type MldTable, type MpdTable } from "@/workspaces/merise/model";
import type { WorkspaceProps } from "../types";
import { DiagramEditor, McdEditor, type DiagramKind } from "./diagrams";

// ─────────────────────────────────────────────────────────────────────────────
// Atelier Merise : sept outils sur UN document commun. Le panneau de cohérence se met à jour à chaque modification ;
// les transformations automatiques (MCD → MLD → MPD → SQL) proposent un résultat que l'étudiant vérifie et corrige.
// ─────────────────────────────────────────────────────────────────────────────

type Tab = "dictionary" | "dependencies" | "mcd" | "mld" | "mpd" | "mct" | "flows";
const TABS: { id: Tab; label: string; area: Issue["area"] }[] = [
  { id: "dictionary", label: "Dictionnaire", area: "dictionnaire" },
  { id: "dependencies", label: "Dépendances", area: "dependances" },
  { id: "mcd", label: "MCD", area: "mcd" },
  { id: "mld", label: "MLD", area: "mld" },
  { id: "mpd", label: "MPD", area: "mpd" },
  { id: "mct", label: "MCT", area: "mct" },
  { id: "flows", label: "Flux", area: "flux" },
];
const MCT_STYLE: Record<string, DiagramKind> = {
  event: { value: "event", label: "Événement", className: "border-sky-500 bg-sky-50 dark:bg-sky-950/30" },
  operation: { value: "operation", label: "Opération", className: "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" },
  result: { value: "result", label: "Résultat", className: "border-violet-500 bg-violet-50 dark:bg-violet-950/30" },
  sync: { value: "sync", label: "Synchronisation", className: "border-amber-500 bg-amber-50 dark:bg-amber-950/30" },
};
const FLOW_KINDS: DiagramKind[] = [
  { value: "interne", label: "Acteur interne", className: "border-primary bg-primary/10" },
  { value: "externe", label: "Acteur externe", className: "border-slate-500 bg-slate-50 dark:bg-slate-900" },
];

const cell = "h-8 px-2 text-xs";
const download = (name: string, text: string, mime: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
};

function IssueList({ issues, empty }: { issues: Issue[]; empty?: string }) {
  if (issues.length === 0) return empty ? <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {empty}</p> : null;
  return (
    <ul className="space-y-1" aria-label="Contrôles de cohérence">
      {issues.map((i, k) => (
        <li key={k} className={cn("flex items-start gap-1.5 text-xs", i.level === "error" ? "text-destructive" : i.level === "warning" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {i.level === "error" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : i.level === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />} {i.message}
        </li>
      ))}
    </ul>
  );
}

export default function MeriseWorkshop({ value, onChange, disabled, payload }: WorkspaceProps) {
  const work = useMemo(() => readMerise(value), [value]);
  const update = useCallback((fn: (w: MeriseWork) => MeriseWork) => onChange(fn(work)), [work, onChange]);
  const [tab, setTab] = useState<Tab>("mcd");
  const issues = useMemo(() => meriseIssues(work), [work]);
  const wanted = ((payload.deliverables as string[] | undefined) ?? []).join(" ").toLowerCase();
  const count = (area: Issue["area"]) => issues.filter((i) => i.area === area && i.level !== "info").length;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Outils de modélisation" className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const n = count(t.area);
          return (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn("flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", tab === t.id ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-muted")}>
              {t.label}
              {wanted.includes(t.label.toLowerCase()) && <span className="rounded bg-primary/15 px-1 text-[10px] text-primary">demandé</span>}
              {n > 0 && <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] text-destructive" title={`${n} point(s) à vérifier`}>{n}</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === "dictionary" && <DictionaryTab work={work} update={update} disabled={disabled} />}
        {tab === "dependencies" && <DependenciesTab work={work} update={update} disabled={disabled} />}
        {tab === "mcd" && <McdEditor work={work} update={update} disabled={disabled} />}
        {tab === "mld" && <MldTab work={work} update={update} disabled={disabled} />}
        {tab === "mpd" && <MpdTab work={work} update={update} disabled={disabled} />}
        {tab === "mct" && (
          <DiagramEditor ariaLabel="Modèle conceptuel des traitements" nodeWord="Élément" kinds={MCT_KINDS.map((k) => MCT_STYLE[k])} ruleField
            nodes={work.mct.nodes.map((n) => ({ ...n }))} edges={work.mct.edges}
            onChange={(nodes, edges) => update((w) => ({ ...w, mct: { nodes: nodes.map((n) => ({ id: n.id, kind: n.kind as (typeof MCT_KINDS)[number], label: n.label, rule: n.rule ?? "", x: n.x, y: n.y })), edges } }))} disabled={disabled} />
        )}
        {tab === "flows" && (
          <DiagramEditor ariaLabel="Graphe des flux" nodeWord="Acteur" kinds={FLOW_KINDS} edgeLabels
            nodes={work.flows.actors.map((a) => ({ id: a.id, label: a.name, kind: a.kind, x: a.x, y: a.y }))}
            edges={work.flows.flows.map((f) => ({ id: f.id, from: f.from, to: f.to, label: f.label }))}
            onChange={(nodes, edges) => update((w) => ({ ...w, flows: { actors: nodes.map((n) => ({ id: n.id, name: n.label, kind: n.kind as "interne" | "externe", x: n.x, y: n.y })), flows: edges.map((e) => ({ id: e.id, from: e.from, to: e.to, label: e.label ?? "" })) } }))} disabled={disabled} />
        )}
      </div>

      <section aria-label="Cohérence des modèles" className="rounded-xl border bg-muted/30 p-3">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cohérence {issues.filter((i) => i.level !== "info").length > 0 ? `· ${issues.filter((i) => i.level !== "info").length} point(s) à vérifier` : ""}</h3>
        <IssueList issues={issues.slice(0, 12)} empty="Aucune incohérence détectée pour l'instant." />
        {issues.length > 12 && <p className="typo-meta mt-1">… et {issues.length - 12} autre(s) : ouvrez l&apos;outil concerné.</p>}
      </section>
    </div>
  );
}

// ── Dictionnaire ─────────────────────────────────────────────────────────────

function DictionaryTab({ work, update, disabled }: { work: MeriseWork; update: (f: (w: MeriseWork) => MeriseWork) => void; disabled?: boolean }) {
  const [q, setQ] = useState("");
  const items = work.dictionary;
  const patch = (id: string, p: Partial<DictionaryItem>) => update((w) => ({ ...w, dictionary: w.dictionary.map((d) => (d.id === id ? { ...d, ...p } : d)) }));
  const shown = items.filter((d) => !q.trim() || fold(`${d.code} ${d.label}`).includes(fold(q)));
  const known = new Set(items.map((d) => fold(d.code)));
  const fromMcd = [...new Set(work.mcd.entities.flatMap((e) => e.attributes.map((a) => a.name.trim())).concat(work.mcd.associations.flatMap((a) => a.attributes.map((x) => x.name.trim()))))].filter((n) => n && !known.has(fold(n)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative"><Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden /><Input aria-label="Rechercher une donnée" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-48 pl-7 text-xs" /></div>
        {!disabled && <Button size="sm" className="gap-1.5" onClick={() => update((w) => ({ ...w, dictionary: [...w.dictionary, { id: newId("d"), code: "", label: "", type: "AN", size: "", format: "", description: "", nature: "elementaire", rule: "", notes: "" }] }))}><Plus className="h-4 w-4" aria-hidden /> Donnée</Button>}
        {!disabled && fromMcd.length > 0 && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => update((w) => ({ ...w, dictionary: [...w.dictionary, ...fromMcd.map((n) => ({ id: newId("d"), code: n, label: n, type: "AN", size: "", format: "", description: "", nature: "elementaire" as const, rule: "", notes: "" }))] }))}><Wand2 className="h-4 w-4" aria-hidden /> Ajouter les {fromMcd.length} propriété(s) du MCD</Button>}
        <span className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!items.length} onClick={() => download("dictionnaire-de-donnees.csv", dictionaryToCsv(items), "text/csv")}><Download className="h-4 w-4" aria-hidden /> CSV</Button>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!items.length} onClick={() => download("dictionnaire-de-donnees.json", JSON.stringify(items.map(({ id: _id, ...d }) => d), null, 2), "application/json")}><Download className="h-4 w-4" aria-hidden /> JSON</Button>
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-muted/50"><tr>{["Code", "Désignation", "Type", "Taille", "Format", "Nature", "Règle de gestion", "Description", "Observations", ""].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={10} className="px-2 py-4 text-center text-muted-foreground">{items.length ? "Aucune donnée ne correspond à la recherche." : "Le dictionnaire est vide : ajoutez vos données (code, désignation, type…)."}</td></tr>}
            {shown.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="p-1"><Input aria-label="Code" className={cn(cell, "w-28")} value={d.code} maxLength={40} disabled={disabled} onChange={(e) => patch(d.id, { code: e.target.value })} /></td>
                <td className="p-1"><Input aria-label="Désignation" className={cn(cell, "w-40")} value={d.label} maxLength={120} disabled={disabled} onChange={(e) => patch(d.id, { label: e.target.value })} /></td>
                <td className="p-1"><Select value={d.type || undefined} onValueChange={(v) => patch(d.id, { type: v })} disabled={disabled}><SelectTrigger aria-label="Type" className="h-8 w-24 text-xs"><SelectValue placeholder="—" /></SelectTrigger><SelectContent>{DATA_TYPES.map((t) => <SelectItem key={t} value={t}>{t} · {DATA_TYPE_LABEL[t]}</SelectItem>)}</SelectContent></Select></td>
                <td className="p-1"><Input aria-label="Taille" className={cn(cell, "w-16")} value={d.size} maxLength={10} disabled={disabled} onChange={(e) => patch(d.id, { size: e.target.value })} /></td>
                <td className="p-1"><Input aria-label="Format" className={cn(cell, "w-20")} value={d.format} maxLength={30} disabled={disabled} onChange={(e) => patch(d.id, { format: e.target.value })} /></td>
                <td className="p-1"><Select value={d.nature} onValueChange={(v) => patch(d.id, { nature: v as DictionaryItem["nature"] })} disabled={disabled}><SelectTrigger aria-label="Nature" className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="elementaire">Élémentaire</SelectItem><SelectItem value="calculee">Calculée</SelectItem></SelectContent></Select></td>
                <td className="p-1"><Input aria-label="Règle de gestion" className={cn(cell, "w-40")} value={d.rule} maxLength={300} disabled={disabled} onChange={(e) => patch(d.id, { rule: e.target.value })} /></td>
                <td className="p-1"><Input aria-label="Description" className={cn(cell, "w-40")} value={d.description} maxLength={300} disabled={disabled} onChange={(e) => patch(d.id, { description: e.target.value })} /></td>
                <td className="p-1"><Input aria-label="Observations" className={cn(cell, "w-32")} value={d.notes} maxLength={300} disabled={disabled} onChange={(e) => patch(d.id, { notes: e.target.value })} /></td>
                <td className="p-1">{!disabled && <button type="button" aria-label="Supprimer la donnée" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => update((w) => ({ ...w, dictionary: w.dictionary.filter((x) => x.id !== d.id) }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <IssueList issues={dictionaryIssues(items)} empty={items.length ? "Dictionnaire cohérent (pas de doublon ni de champ manquant)." : undefined} />
    </div>
  );
}

// ── Dépendances fonctionnelles ───────────────────────────────────────────────

const list = (s: string) => s.split(/[,;+]/).map((x) => x.trim()).filter(Boolean);

function DependencyGraph({ deps }: { deps: Dependency[] }) {
  const names = [...new Set(deps.flatMap((d) => [...d.from, ...d.to]).filter(Boolean))].slice(0, 24);
  if (names.length === 0) return null;
  const R = 130;
  const pos = new Map(names.map((n, i) => [fold(n), { x: 170 + R * Math.cos((2 * Math.PI * i) / names.length - Math.PI / 2), y: 160 + R * Math.sin((2 * Math.PI * i) / names.length - Math.PI / 2) }]));
  return (
    <svg viewBox="0 0 340 320" role="img" aria-label="Graphe des dépendances fonctionnelles" className="mx-auto max-h-80 w-full max-w-md rounded-xl border bg-card">
      <defs><marker id="dfa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor" /></marker></defs>
      {deps.flatMap((d) => d.from.flatMap((f) => d.to.map((t) => ({ f, t, composite: d.from.length > 1 })))).map(({ f, t, composite }, i) => {
        const a = pos.get(fold(f));
        const b = pos.get(fold(t));
        if (!a || !b || a === b) return null;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        return <line key={i} x1={a.x + (dx / len) * 14} y1={a.y + (dy / len) * 14} x2={b.x - (dx / len) * 18} y2={b.y - (dy / len) * 18} stroke="currentColor" strokeWidth="1.3" strokeDasharray={composite ? "4 3" : undefined} markerEnd="url(#dfa)" className="text-muted-foreground" />;
      })}
      {names.map((n) => {
        const p = pos.get(fold(n))!;
        return <g key={n}><circle cx={p.x} cy={p.y} r="13" className="fill-primary/15 stroke-primary" /><text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="8" className="fill-foreground">{n.length > 9 ? `${n.slice(0, 8)}…` : n}</text></g>;
      })}
    </svg>
  );
}

function DependenciesTab({ work, update, disabled }: { work: MeriseWork; update: (f: (w: MeriseWork) => MeriseWork) => void; disabled?: boolean }) {
  const deps = work.dependencies;
  const [keys, setKeys] = useState<string[][] | null | undefined>(undefined);
  const codes = work.dictionary.filter((d) => d.code.trim() && d.nature !== "calculee").map((d) => d.code.trim());
  const patch = (id: string, p: Partial<Dependency>) => update((w) => ({ ...w, dependencies: w.dependencies.map((d) => (d.id === id ? { ...d, ...p } : d)) }));
  return (
    <div className="space-y-3">
      <datalist id="df-codes">{codes.map((c) => <option key={c} value={c} />)}</datalist>
      <p className="typo-meta">Sources (à gauche) et cibles (à droite) : saisissez des codes du dictionnaire, séparés par des virgules. Une source composée (a, b) est tracée en pointillés.</p>
      <ul className="space-y-1.5">
        {deps.map((d) => (
          <li key={d.id} className="flex items-center gap-2">
            <Input aria-label="Sources de la dépendance" list="df-codes" className="h-8 flex-1 text-xs" placeholder="idClient" defaultValue={d.from.join(", ")} key={`${d.id}-f`} disabled={disabled} onBlur={(e) => patch(d.id, { from: list(e.target.value) })} />
            <span aria-hidden className="text-muted-foreground">→</span>
            <Input aria-label="Cibles de la dépendance" list="df-codes" className="h-8 flex-1 text-xs" placeholder="nom, prénom" defaultValue={d.to.join(", ")} key={`${d.id}-t`} disabled={disabled} onBlur={(e) => patch(d.id, { to: list(e.target.value) })} />
            {!disabled && <button type="button" aria-label="Supprimer la dépendance" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => update((w) => ({ ...w, dependencies: w.dependencies.filter((x) => x.id !== d.id) }))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {!disabled && <Button size="sm" className="gap-1.5" onClick={() => update((w) => ({ ...w, dependencies: [...w.dependencies, { id: newId("f"), from: [], to: [] }] }))}><Plus className="h-4 w-4" aria-hidden /> Dépendance</Button>}
        <Button size="sm" variant="outline" className="gap-1.5" disabled={deps.length === 0} onClick={() => setKeys(candidateKeys(codes.length ? codes : [...new Set(deps.flatMap((d) => [...d.from, ...d.to]))], deps))}><Sparkles className="h-4 w-4" aria-hidden /> Clés candidates</Button>
      </div>
      {keys === null && <p className="text-xs text-muted-foreground">Trop de données (plus de 14) pour calculer les clés ici.</p>}
      {keys && <p className="text-xs"><span className="font-medium">Clés candidates : </span>{keys.length ? keys.map((k) => `{${k.join(", ")}}`).join(" · ") : "aucune trouvée avec ces dépendances"}</p>}
      <DependencyGraph deps={deps} />
      <IssueList issues={meriseIssues({ ...work, mcd: { entities: [], associations: [] }, dictionary: work.dictionary }).filter((i) => i.area === "dependances")} empty={deps.length ? "Dépendances cohérentes." : undefined} />
    </div>
  );
}

// ── MLD ──────────────────────────────────────────────────────────────────────

function TableEditor({ tables, onChange, disabled, mpd }: { tables: (MldTable | MpdTable)[]; onChange: (t: (MldTable | MpdTable)[]) => void; disabled?: boolean; mpd?: boolean }) {
  const patchTable = (id: string, f: (t: MldTable | MpdTable) => MldTable | MpdTable) => onChange(tables.map((t) => (t.id === id ? f(t) : t)));
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {tables.map((t) => (
        <div key={t.id} className="rounded-xl border bg-card">
          <div className="flex items-center gap-1.5 border-b bg-muted/40 p-1.5">
            <Input aria-label="Nom de la table" className="h-8 flex-1 text-xs font-semibold" value={t.name} maxLength={60} disabled={disabled} onChange={(e) => patchTable(t.id, (x) => ({ ...x, name: e.target.value }))} />
            {!disabled && <button type="button" aria-label="Supprimer la table" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => onChange(tables.filter((x) => x.id !== t.id))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>}
          </div>
          <ul className="space-y-1 p-1.5">
            {t.columns.map((c) => {
              const col = c as MpdTable["columns"][number];
              const setCol = (p: Partial<MpdTable["columns"][number]>) => patchTable(t.id, (x) => ({ ...x, columns: x.columns.map((y) => (y.id === c.id ? { ...y, ...p } : y)) as typeof x.columns }));
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-1">
                  <label className="flex items-center gap-0.5 text-[10px]" title="Clé primaire"><input type="checkbox" aria-label="Clé primaire" checked={c.pk} disabled={disabled} onChange={(e) => setCol({ pk: e.target.checked })} />PK</label>
                  <Input aria-label="Nom de la colonne" className={cn(cell, "w-28 flex-1")} value={c.name} maxLength={60} disabled={disabled} onChange={(e) => setCol({ name: e.target.value })} />
                  {mpd && <Input aria-label="Type" className={cn(cell, "w-20")} placeholder="Type" value={col.type ?? ""} maxLength={30} disabled={disabled} onChange={(e) => setCol({ type: e.target.value })} />}
                  {mpd && <Input aria-label="Taille" className={cn(cell, "w-12")} placeholder="Taille" value={col.size ?? ""} maxLength={10} disabled={disabled} onChange={(e) => setCol({ size: e.target.value })} />}
                  {mpd && <label className="flex items-center gap-0.5 text-[10px]" title="Non nul"><input type="checkbox" aria-label="Non nul" checked={!!col.notNull} disabled={disabled} onChange={(e) => setCol({ notNull: e.target.checked })} />NN</label>}
                  {mpd && <label className="flex items-center gap-0.5 text-[10px]" title="Unique"><input type="checkbox" aria-label="Unique" checked={!!col.unique} disabled={disabled} onChange={(e) => setCol({ unique: e.target.checked })} />UQ</label>}
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <Input aria-label="Table référencée" className={cn(cell, "w-20")} placeholder="table FK" value={c.fkTable} maxLength={60} disabled={disabled} onChange={(e) => setCol({ fkTable: e.target.value })} />
                  <Input aria-label="Colonne référencée" className={cn(cell, "w-20")} placeholder="colonne FK" value={c.fkColumn} maxLength={60} disabled={disabled} onChange={(e) => setCol({ fkColumn: e.target.value })} />
                  {!disabled && <button type="button" aria-label="Supprimer la colonne" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => patchTable(t.id, (x) => ({ ...x, columns: x.columns.filter((y) => y.id !== c.id) as typeof x.columns }))}><Trash2 className="h-3 w-3" aria-hidden /></button>}
                </li>
              );
            })}
            {!disabled && <li><Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => patchTable(t.id, (x) => ({ ...x, columns: [...x.columns, mpd ? { id: newId("c"), name: "", pk: false, fkTable: "", fkColumn: "", type: "", size: "", notNull: false, unique: false } : { id: newId("c"), name: "", pk: false, fkTable: "", fkColumn: "" }] as typeof x.columns }))}><Plus className="h-3 w-3" aria-hidden /> Colonne</Button></li>}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MldTab({ work, update, disabled }: { work: MeriseWork; update: (f: (w: MeriseWork) => MeriseWork) => void; disabled?: boolean }) {
  const tables = work.mld.tables;
  const generate = async () => {
    if (work.mld.edited && tables.length && !(await confirmAction("Remplacer le MLD actuel (modifié à la main) par celui que donnent les règles de passage depuis votre MCD ?", { confirmLabel: "Remplacer", danger: true }))) return;
    update((w) => ({ ...w, mld: { tables: mcdToMld(w.mcd), edited: false } }));
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!disabled && <Button size="sm" className="gap-1.5" onClick={() => void generate()} disabled={work.mcd.entities.length === 0}><Wand2 className="h-4 w-4" aria-hidden /> Générer depuis le MCD</Button>}
        {!disabled && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => update((w) => ({ ...w, mld: { tables: [...w.mld.tables, { id: newId("t"), name: "", columns: [] }], edited: true } }))}><Plus className="h-4 w-4" aria-hidden /> Table</Button>}
        <p className="typo-meta">Règles : chaque entité devient une table ; la clé étrangère va du côté « 1 » ; une association plusieurs-à-plusieurs devient une table. Vérifiez et corrigez le résultat.</p>
      </div>
      {tables.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{work.mcd.entities.length ? "Générez le MLD depuis votre MCD, ou construisez-le table par table." : "Construisez d'abord votre MCD pour pouvoir en dériver le MLD."}</p>}
      <TableEditor tables={tables} disabled={disabled} onChange={(t) => update((w) => ({ ...w, mld: { tables: t as MldTable[], edited: true } }))} />
      {tables.length > 0 && <IssueList issues={meriseIssues({ ...work, dictionary: [], dependencies: [], mpd: { tables: [], edited: false }, mct: { nodes: [], edges: [] }, flows: { actors: [], flows: [] }, mcd: work.mcd }).filter((i) => i.area === "mld")} empty="MLD conforme aux règles de passage depuis votre MCD." />}
    </div>
  );
}

// ── MPD et SQL ───────────────────────────────────────────────────────────────

function MpdTab({ work, update, disabled }: { work: MeriseWork; update: (f: (w: MeriseWork) => MeriseWork) => void; disabled?: boolean }) {
  const tables = work.mpd.tables;
  const sql = useMemo(() => (tables.length ? mpdToSql(tables) : ""), [tables]);
  const [test, setTest] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });
  const generate = async () => {
    if (work.mpd.edited && tables.length && !(await confirmAction("Remplacer le MPD actuel (modifié à la main) par celui déduit du MLD et du dictionnaire ?", { confirmLabel: "Remplacer", danger: true }))) return;
    update((w) => ({ ...w, mpd: { tables: mldToMpd(w.mld.tables, w.dictionary), edited: false } }));
  };
  async function run() {
    setTest({ busy: true });
    try {
      const r = await api.post<{ ok: boolean; error?: string; statements?: { rows?: unknown[][] }[] }>("/api/sql/run", { sql: "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", setupSql: sql });
      const names = (r.statements?.at(-1)?.rows ?? []).map((row) => String(row[0]));
      setTest({ busy: false, ok: r.ok, text: r.ok ? `Script exécuté sans erreur dans une base isolée. Tables créées : ${names.join(", ") || "aucune"}.` : (r.error ?? "Erreur d'exécution.") });
    } catch (e) {
      setTest({ busy: false, ok: false, text: e instanceof Error ? e.message : "Exécution impossible." });
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!disabled && <Button size="sm" className="gap-1.5" onClick={() => void generate()} disabled={work.mld.tables.length === 0}><Wand2 className="h-4 w-4" aria-hidden /> Générer depuis le MLD</Button>}
        {!disabled && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => update((w) => ({ ...w, mpd: { tables: [...w.mpd.tables, { id: newId("t"), name: "", columns: [] }], edited: true } }))}><Plus className="h-4 w-4" aria-hidden /> Table</Button>}
        <p className="typo-meta">Les types viennent du dictionnaire de données (à défaut : entier pour les clés, texte sinon).</p>
      </div>
      {tables.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{work.mld.tables.length ? "Générez le MPD depuis votre MLD." : "Le MPD se déduit du MLD : commencez par le MLD."}</p>}
      <TableEditor mpd tables={tables} disabled={disabled} onChange={(t) => update((w) => ({ ...w, mpd: { tables: t as MpdTable[], edited: true } }))} />
      {tables.length > 0 && <IssueList issues={meriseIssues({ ...work, dictionary: [], dependencies: [], mld: { tables: [], edited: false }, mcd: { entities: [], associations: [] }, mct: { nodes: [], edges: [] }, flows: { actors: [], flows: [] } }).filter((i) => i.area === "mpd")} empty="MPD cohérent (types, clés primaires et étrangères)." />}
      {sql && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">Script SQL</h4>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void navigator.clipboard?.writeText(sql)}>Copier</Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => download("schema.sql", sql, "text/plain")}><Download className="h-4 w-4" aria-hidden /> Télécharger</Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={test.busy} onClick={() => void run()}>{test.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Tester le script</Button>
          </div>
          <pre className="max-h-72 overflow-auto rounded-xl border bg-muted/40 p-3 font-code text-xs" aria-label="Script SQL généré">{sql}</pre>
          {test.text && <p role="status" className={cn("text-xs", test.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>{test.text}</p>}
        </div>
      )}
    </div>
  );
}
