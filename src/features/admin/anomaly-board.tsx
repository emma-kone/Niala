"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, ClipboardCopy, Undo2 } from "lucide-react";
import { notify } from "@/components/notifications";
import { cn } from "@/lib/utils";

// Liste des anomalies comme une liste de tâches : chacune se copie sous forme de prompt, se marque « traitée » et la liste
// entière se copie dans l'ordre de priorité. Les anomalies traitées sont mémorisées dans ce navigateur.

export interface AnomalyView {
  id: string;
  priority: "P1" | "P2" | "P3" | "P4";
  category: string;
  title: string;
  summary: string;
  evidence: string[];
  files: string[];
  prompt: string;
}

const TONE: Record<AnomalyView["priority"], string> = {
  P1: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  P2: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  P3: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  P4: "bg-muted text-muted-foreground",
};
const STORAGE_KEY = "niala:admin:anomalies-done";

function readDone(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    notify({ title: "Copié", description: label, variant: "success" });
  } catch {
    notify({ title: "Copie impossible", description: "Sélectionnez le texte et copiez-le manuellement.", variant: "error" });
  }
}

export function AnomalyBoard({ anomalies, masterPrompt, priorityLabels }: { anomalies: AnomalyView[]; masterPrompt: string; priorityLabels: Record<string, string> }) {
  const [done, setDone] = useState<string[]>([]);
  const [open, setOpen] = useState<string[]>([]);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setDone(readDone()), 0);
    return () => window.clearTimeout(t);
  }, []);

  const mark = (id: string, value: boolean) => {
    const next = value ? [...readDone().filter((x) => x !== id), id] : readDone().filter((x) => x !== id);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-300)));
    } catch {
      /* stockage indisponible */
    }
    setDone(next);
  };

  const todo = anomalies.filter((a) => !done.includes(a.id));
  const finished = anomalies.filter((a) => done.includes(a.id));
  const todoPrompt = todo.length === anomalies.length ? masterPrompt : [`# Plan de correction : ${todo.length} anomalie(s) restante(s), par ordre de priorité`, "", ...todo.flatMap((a, i) => [`## Tâche ${i + 1} / ${todo.length}`, "", a.prompt, "", "---", ""])].join("\n");

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={!todo.length} onClick={() => void copy(todoPrompt, `${todo.length} tâche(s), de la plus prioritaire à la moins prioritaire.`)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
          <ClipboardCopy className="h-4 w-4" aria-hidden />Copier tous les prompts (par priorité)
        </button>
        {finished.length > 0 && (
          <button type="button" onClick={() => setShowDone((v) => !v)} className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">
            {showDone ? "Masquer" : "Voir"} les {finished.length} anomalie(s) traitée(s)
          </button>
        )}
      </div>

      {!todo.length && <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">{anomalies.length ? "Toutes les anomalies de cette liste sont marquées comme traitées." : "Aucune anomalie détectée sur la période : rien à corriger pour le moment."}</p>}

      <ol className="space-y-3">
        {todo.map((a, i) => (
          <Card key={a.id} a={a} rank={i + 1} expanded={open.includes(a.id)} onToggle={() => setOpen((o) => (o.includes(a.id) ? o.filter((x) => x !== a.id) : [...o, a.id]))} onDone={() => mark(a.id, true)} priorityLabel={priorityLabels[a.priority]} />
        ))}
      </ol>

      {showDone && finished.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Traitées</h2>
          <ul className="space-y-2">
            {finished.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                <span className="min-w-0 truncate line-through">{a.title}</span>
                <button type="button" onClick={() => mark(a.id, false)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs hover:bg-muted"><Undo2 className="h-3.5 w-3.5" aria-hidden />Rouvrir</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Card({ a, rank, expanded, onToggle, onDone, priorityLabel }: { a: AnomalyView; rank: number; expanded: boolean; onToggle: () => void; onDone: () => void; priorityLabel: string }) {
  return (
    <li className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums" aria-label={`Tâche ${rank}`}>{rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span title={priorityLabel} className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", TONE[a.priority])}>{a.priority}</span>
            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">{a.category}</span>
          </div>
          <h2 className="mt-1.5 text-sm font-semibold">{a.title}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{a.summary}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{a.evidence.map((e) => <li key={e} className="break-words">{e}</li>)}</ul>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => void copy(a.prompt, a.title)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"><ClipboardCopy className="h-3.5 w-3.5" aria-hidden />Copier le prompt</button>
          <button type="button" onClick={onDone} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"><Check className="h-3.5 w-3.5" aria-hidden />Marquer traitée</button>
        </div>
      </div>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        {expanded ? <ChevronDown className="h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}Voir le prompt
      </button>
      {expanded && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-xs leading-relaxed">{a.prompt}</pre>}
    </li>
  );
}
