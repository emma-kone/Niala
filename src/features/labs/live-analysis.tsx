"use client";

import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import type { CodeAnalysisDto } from "./types";

const DEBOUNCE_MS = 900;

/**
 * Analyse en direct : après une courte pause de frappe, le serveur vérifie le code avec les outils du langage
 * (il ne l'exécute jamais). La réponse n'est utilisée que si elle correspond encore au code affiché.
 */
export function useLiveAnalysis(language: string, code: string, workspaceId: string) {
  const [state, setState] = useState<{ analysis: CodeAnalysisDto | null; forCode: string | null; busy: boolean; error: string | null }>({ analysis: null, forCode: null, busy: false, error: null });
  const latest = useRef(0);

  useEffect(() => {
    if (!code.trim()) return;
    const ticket = ++latest.current;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, busy: true }));
      api
        .post<{ analysis: CodeAnalysisDto }>("/api/labs/analyze", { language, content: code, workspaceId })
        .then((r) => ticket === latest.current && setState({ analysis: r.analysis, forCode: code, busy: false, error: null }))
        .catch((e) => ticket === latest.current && setState((s) => ({ ...s, busy: false, error: e instanceof Error ? e.message : "Analyse indisponible." })));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [language, code, workspaceId]);

  // Une analyse ne vaut que pour le code qu'elle a examiné
  const fresh = state.forCode === code;
  return { analysis: code.trim() ? state.analysis : null, fresh, busy: state.busy || (!fresh && !!code.trim() && !state.error), error: state.error };
}

/** Marque dans l'éditeur les lignes en erreur détectées par les outils (soulignement + info-bulle + marge). */
export function useLintMarkers(view: EditorView | null, analysis: CodeAnalysisDto | null, fresh: boolean) {
  useEffect(() => {
    if (!view) return;
    const doc = view.state.doc;
    const diagnostics: Diagnostic[] = fresh && analysis
      ? analysis.problems.map((p) => {
          const line = doc.line(Math.min(Math.max(1, p.line), doc.lines));
          const from = Math.min(line.to, line.from + Math.max(0, (p.column ?? 1) - 1));
          const to = Math.max(from + 1, line.to);
          return { from, to: Math.min(to, doc.length), severity: p.severity, message: p.hint ? `${p.message}\n${p.hint}` : p.message, source: p.source };
        })
      : [];
    view.dispatch(setDiagnostics(view.state, diagnostics));
  }, [view, analysis, fresh]);
}

const SOURCE_LABEL: Record<string, string> = { sucrase: "l'analyseur JavaScript/TypeScript", python: "le compilateur Python", sqlite: "le moteur SQLite", brackets: "le contrôle des délimiteurs" };

/** Bandeau d'état : ce que les OUTILS ont établi, et si le code peut être exécuté ici. */
export function AnalysisStrip({ analysis, fresh, busy, error }: { analysis: CodeAnalysisDto | null; fresh: boolean; busy: boolean; error: string | null }) {
  if (!analysis && !busy && !error) return null;
  const errors = analysis?.problems.filter((p) => p.severity === "error") ?? [];
  let tone: "ok" | "bad" | "info" | "wait" = "wait";
  let text = "Analyse en cours…";
  if (analysis && fresh) {
    if (analysis.summary === "ok") {
      tone = "ok";
      text = analysis.executable ? "Syntaxe valide · exécutable ici" : "Syntaxe valide";
    } else if (analysis.summary === "syntax_error") {
      tone = "bad";
      text = `${errors.length} erreur${errors.length > 1 ? "s" : ""} détectée${errors.length > 1 ? "s" : ""} par ${SOURCE_LABEL[errors[0]?.source] ?? "l'outil"} · le code ne s'exécutera pas tel quel`;
    } else if (analysis.summary === "not_executable") {
      tone = "info";
      text = "Non exécutable ici";
    } else if (analysis.summary === "unavailable") {
      tone = "info";
      text = "Analyse indisponible pour le moment (exécution isolée non disponible)";
    } else tone = "info";
  } else if (error) {
    tone = "info";
    text = error;
  }
  const Icon = tone === "ok" ? CheckCircle2 : tone === "bad" ? XCircle : tone === "wait" ? Loader2 : CircleSlash;
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className={cn("flex items-center gap-2 text-xs font-medium", tone === "ok" && "text-emerald-600 dark:text-emerald-400", tone === "bad" && "text-destructive", tone !== "ok" && tone !== "bad" && "text-muted-foreground")}>
        <Icon className={cn("h-3.5 w-3.5", tone === "wait" && "animate-spin")} aria-hidden /> {text}
        {busy && analysis && !(fresh && analysis) ? null : null}
      </p>
      {analysis && fresh && analysis.summary === "not_executable" && (
        <div className="rounded-md border bg-muted/40 p-2 text-xs">
          <p>{analysis.executableReason}</p>
          <p className="mt-1 text-muted-foreground">{analysis.verification === "form" ? "Seuls les délimiteurs (parenthèses, accolades, guillemets) sont vérifiés : ce n'est pas une compilation." : "Aucune vérification automatique n'est disponible pour ce langage."}</p>
        </div>
      )}
      {analysis && fresh && analysis.problems.length > 0 && (
        <ul className="space-y-1.5" aria-label="Problèmes détectés par les outils">
          {analysis.problems.map((p, i) => (
            <li key={i} className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
              <p className="flex items-start gap-1.5 font-medium">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                <span>
                  Ligne {p.line}
                  {p.column ? `, colonne ${p.column}` : ""} · {p.message}
                </span>
              </p>
              {p.hint && <p className="mt-1 pl-5 text-muted-foreground">{p.hint}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
