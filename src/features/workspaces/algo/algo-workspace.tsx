"use client";

import { useCallback, useMemo, useState } from "react";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { AlertTriangle, CheckCircle2, Info, Loader2, Play, XCircle } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { lintAlgo } from "@/workspaces/algo/logic";
import { ALGO_LANGUAGES, ALGO_LANGUAGE_LABEL, EXECUTABLE, readAlgo, type AlgoLanguage, type AlgoWork } from "@/workspaces/algo/model";
import type { WorkspaceProps } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Éditeur d'algorithmique et de programmation. Pseudo-code : aucun langage réel n'est imposé, la structure est vérifiée
// selon le formalisme français usuel. Python, JavaScript et TypeScript s'exécutent dans le runner isolé de Niala
// (jamais sur le serveur principal) ; les autres langages sont simplement édités et analysés.
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE = `Algorithme MonAlgorithme
Variables
  n, i, somme : entier
Début
  Lire(n)
  somme ← 0
  Pour i de 1 à n Faire
    somme ← somme + i
  FinPour
  Écrire(somme)
Fin`;

export default function AlgoWorkspace({ value, onChange, disabled, payload }: WorkspaceProps) {
  const requested = ALGO_LANGUAGES.includes(payload.language as AlgoLanguage) ? (payload.language as AlgoLanguage) : "pseudo";
  const work = useMemo(() => readAlgo(value, requested), [value, requested]);
  const update = useCallback((patch: Partial<AlgoWork>) => onChange({ ...work, ...patch }), [work, onChange]);
  const { resolvedTheme } = useTheme();
  const [running, setRunning] = useState(false);
  const formalism = typeof payload.formalism === "string" && payload.formalism ? payload.formalism : null;
  const issues = useMemo(() => lintAlgo(work.code, work.language), [work.code, work.language]);
  const problems = issues.filter((i) => i.level !== "info");
  const extensions = useMemo<Extension[]>(() => (work.language === "python" ? [python()] : work.language === "javascript" || work.language === "typescript" ? [javascript({ typescript: work.language === "typescript" })] : []), [work.language]);
  const executable = EXECUTABLE.includes(work.language);

  async function run() {
    if (!work.code.trim()) return;
    setRunning(true);
    try {
      const r = await api.post<{ ok: boolean; stdout: string; stderr: string; note?: string }>("/api/execute", { language: work.language, code: work.code });
      update({ lastRun: { ok: r.ok, output: [r.stdout, r.stderr, r.note].filter(Boolean).join("\n").slice(0, 8000) || "(aucune sortie)" } });
    } catch (e) {
      update({ lastRun: { ok: false, output: e instanceof Error ? e.message : "Exécution impossible." } });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={work.language} onValueChange={(v) => update({ language: v as AlgoLanguage, lastRun: null })} disabled={disabled}>
          <SelectTrigger aria-label="Langage" className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{ALGO_LANGUAGES.map((l) => <SelectItem key={l} value={l}>{ALGO_LANGUAGE_LABEL[l]}</SelectItem>)}</SelectContent>
        </Select>
        {!disabled && executable && <Button size="sm" className="gap-1.5" disabled={running || !work.code.trim()} onClick={() => void run()}>{running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} Exécuter</Button>}
        {!disabled && work.language === "pseudo" && !work.code.trim() && <Button size="sm" variant="outline" onClick={() => update({ code: SAMPLE })}>Insérer un modèle</Button>}
        <span className="ml-auto text-xs text-muted-foreground">{executable ? "Exécution isolée (Ctrl + Entrée)" : work.language === "pseudo" ? "Vérification de la structure" : "Édition et analyse (pas d'exécution pour ce langage)"}</span>
      </div>
      {formalism && <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs"><span className="font-medium">Formalisme demandé : </span>{formalism}</p>}

      <div className="overflow-hidden rounded-xl border" onKeyDown={(e) => { if (!disabled && executable && (e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); void run(); } }}>
        <CodeMirror value={work.code} height="340px" theme={resolvedTheme === "dark" ? oneDark : "light"} extensions={extensions} editable={!disabled} onChange={(v) => update({ code: v })} aria-label="Éditeur de code" basicSetup={{ lineNumbers: true, foldGutter: false }} />
      </div>

      <section aria-label="Vérification" className="rounded-xl border bg-muted/30 p-3">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vérification</h3>
        {!work.code.trim() ? <p className="text-xs text-muted-foreground">Écrivez votre algorithme : la structure sera vérifiée au fil de la saisie.</p> : issues.length === 0 ? <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Aucun problème de structure détecté.</p> : (
          <ul className="space-y-1">
            {issues.slice(0, 12).map((i, k) => (
              <li key={k} className={cn("flex items-start gap-1.5 text-xs", i.level === "error" ? "text-destructive" : i.level === "warning" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                {i.level === "error" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : i.level === "warning" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />}
                <span><span className="font-medium">Ligne {i.line} :</span> {i.message}</span>
              </li>
            ))}
          </ul>
        )}
        {problems.length === 0 && issues.length > 0 && <p className="typo-meta mt-1">Seules des remarques facultatives subsistent.</p>}
      </section>

      {work.lastRun && (
        <section aria-label="Résultat de l'exécution">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sortie {work.lastRun.ok ? "" : "· erreur"}</h3>
          <pre className={cn("max-h-52 overflow-auto rounded-xl border p-3 font-code text-xs", work.lastRun.ok ? "bg-muted/40" : "border-destructive/40 bg-destructive/5")}>{work.lastRun.output}</pre>
        </section>
      )}
    </div>
  );
}
