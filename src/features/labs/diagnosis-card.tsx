"use client";

import { useState } from "react";
import { BookOpen, HelpCircle, Loader2, Microscope, Send, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, type DiagnosisReportDto } from "./types";

const ACTION_TEXT: Record<string, string> = {
  retry: "Corrigez puis relancez : la cause est identifiée.",
  targeted_explanation: "Relisez la règle concernée avant de réessayer.",
  review_prerequisite: "Vérifiez d'abord la notion de base signalée, puis reprenez cet exercice.",
  clarifying_question: "Une question de vérification permettrait de savoir si la notion est bien comprise.",
  check_environment: "Ce n'est pas une erreur de votre part : l'environnement d'exécution ne fournit pas cette ressource.",
  verify_understanding: "Réussite avec aide : vérifiez que vous pourriez refaire l'exercice sans indice.",
  none: "",
};

const SEVERITY: Record<string, string> = { none: "", low: "Gravité faible", medium: "Gravité moyenne", high: "Gravité élevée" };

const LEVELS = [
  { level: 1, label: "Indice" },
  { level: 2, label: "Explication ciblée" },
  { level: 3, label: "Décomposition" },
  { level: 4, label: "Exemple" },
  { level: 5, label: "Correction expliquée" },
  { level: 6, label: "Vérifier ma compréhension" },
] as const;

const UNDERSTANDING: Record<string, string> = {
  understood: "Explication jugée correcte",
  partial: "Explication incomplète",
  not_understood: "Explication à revoir",
  unclear: "Réponse insuffisante pour conclure",
  unassessed: "Réponse enregistrée, non évaluée",
};

interface FullView extends DiagnosisReportDto {
  interpretation: { accepted: boolean; reason?: string; summary: string; misconception: string | null; confidence: number } | null;
  help: { level: number; text: string; source: "ai" | "rules"; sources: { document: string; page: number | null }[] }[];
  followups: { id: string; question: string; purpose: string; answer: string | null; assessment: { understanding: string; justification: string; source: string } | null }[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Action impossible.");

/**
 * Diagnostic pédagogique d'une tentative. Distingue ce que les OUTILS ont établi (fait) des pistes à vérifier (hypothèses),
 * dit franchement quand la cause est indéterminée, et propose un accompagnement progressif.
 */
export function DiagnosisCard({ report }: { report: DiagnosisReportDto }) {
  const [view, setView] = useState<FullView | DiagnosisReportDto>(report);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const full = view as Partial<FullView>;
  if (view.state === "NONE" && !view.needsVerification) return null;

  const uncertain = view.state === "UNCERTAIN";
  const hypothesis = view.needsVerification && !uncertain;
  const Icon = uncertain ? HelpCircle : hypothesis ? Microscope : ShieldCheck;
  const badge = uncertain ? "Cause indéterminée" : hypothesis ? "Piste à vérifier" : view.primary === "ENVIRONMENT" ? "Environnement" : "Constat des outils";
  const used = new Set((full.help ?? []).map((h) => h.level));
  const next = ([1, 2, 3, 4, 5, 6] as const).find((l) => !used.has(l));

  async function call<T extends { report: FullView }>(key: string, fn: () => Promise<T>) {
    setBusy(key);
    setError(null);
    try {
      setView((await fn()).report);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Diagnostic pédagogique" className={cn("mt-4 space-y-3 rounded-lg border p-3 text-sm", hypothesis || uncertain ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/30")}>
      <header className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden />
        <h3 className="font-semibold">{view.primary ? CATEGORY_LABEL[view.primary] ?? view.primary : "Diagnostic"}</h3>
        <span className="rounded-full border px-2 py-0.5 text-[11px]">{badge}</span>
        {view.severity !== "none" && view.pedagogical && <span className="text-[11px] text-muted-foreground">{SEVERITY[view.severity]}</span>}
        {view.state !== "NONE" && <span className="ml-auto text-[11px] text-muted-foreground">Confiance {Math.round(view.confidence * 100)} %</span>}
      </header>
      <p>{view.summary}</p>

      {view.secondary.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Pistes secondaires : {view.secondary.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")} (hypothèses, non établies).
        </p>
      )}
      {view.evidence.length > 0 && (
        <details open={view.evidence.length <= 3}>
          <summary className="cursor-pointer text-xs font-medium">Preuves observées</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {view.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {view.prerequisites.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Bases à vérifier</p>
          <ul className="list-disc pl-5">
            {view.prerequisites.map((p, i) => (
              <li key={i}>
                <strong>{p.name}</strong> — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ACTION_TEXT[view.recommendedAction] && <p className="text-xs text-muted-foreground">{ACTION_TEXT[view.recommendedAction]}</p>}

      {full.interpretation && (
        <div className={cn("rounded-md border p-2 text-xs", full.interpretation.accepted ? "border-violet-500/40 bg-violet-500/5" : "text-muted-foreground")}>
          {full.interpretation.accepted ? (
            <>
              <p className="flex items-center gap-1.5 font-semibold">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Hypothèse de l&apos;IA (non établie par les outils)
              </p>
              <p className="mt-1">{full.interpretation.summary}</p>
              {full.interpretation.misconception && <p className="mt-1 text-muted-foreground">Idée fausse possible : {full.interpretation.misconception}</p>}
            </>
          ) : (
            <p>Une piste proposée par l&apos;IA a été écartée car elle ne correspondait pas aux preuves ({full.interpretation.reason}). Le diagnostic des outils reste inchangé.</p>
          )}
        </div>
      )}

      {(full.followups ?? []).map((f) => (
        <div key={f.id} className="rounded-md border bg-background p-2 text-xs">
          <p className="font-medium">{f.question}</p>
          <p className="text-muted-foreground">{f.purpose}</p>
          {f.answer ? (
            <div className="mt-1 space-y-0.5">
              <p className="whitespace-pre-wrap">Votre réponse : {f.answer}</p>
              {f.assessment && (
                <p className="text-muted-foreground">
                  <strong>{UNDERSTANDING[f.assessment.understanding] ?? f.assessment.understanding}</strong> — {f.assessment.justification}
                </p>
              )}
            </div>
          ) : (
            <form
              className="mt-2 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const a = (answers[f.id] ?? "").trim();
                if (a) void call(`f-${f.id}`, () => api.post<{ report: FullView }>(`/api/diagnosis/followups/${f.id}`, { answer: a }));
              }}
            >
              <Textarea aria-label="Votre réponse" rows={2} maxLength={2000} className="min-h-0 text-xs" value={answers[f.id] ?? ""} onChange={(e) => setAnswers((m) => ({ ...m, [f.id]: e.target.value }))} placeholder="Expliquez avec vos mots…" />
              <Button type="submit" size="icon" className="h-8 w-8 shrink-0" disabled={busy !== null || !(answers[f.id] ?? "").trim()} aria-label="Envoyer ma réponse">
                {busy === `f-${f.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              </Button>
            </form>
          )}
        </div>
      ))}

      {(full.help ?? []).map((h, i) => (
        <div key={i} className="rounded-md border-l-4 border-primary bg-muted/50 p-2 text-xs">
          <p className="mb-1 font-semibold uppercase tracking-wide text-muted-foreground">
            {LEVELS[h.level - 1]?.label} · {h.source === "ai" ? "tuteur IA" : "d'après les constats"}
          </p>
          <p className="whitespace-pre-wrap">{h.text}</p>
          {h.sources.length > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-muted-foreground">
              <BookOpen className="h-3 w-3" aria-hidden /> Dans votre cours : {h.sources.map((s) => `${s.document}${s.page ? `, p. ${s.page}` : ""}`).join(" · ")}
            </p>
          )}
        </div>
      ))}

      {view.pedagogical && view.state !== "NONE" && (
        <div className="space-y-2 border-t pt-2">
          <div className="flex flex-wrap gap-1.5">
            {!full.interpretation && (
              <Button size="sm" variant="secondary" className="h-7 gap-1.5 text-xs" disabled={busy !== null} onClick={() => void call("interpret", () => api.post<{ report: FullView }>(`/api/diagnosis/${view.id}/interpret`))}>
                {busy === "interpret" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />} Comprendre mon erreur
              </Button>
            )}
            {LEVELS.map((l) => (
              <Button key={l.level} size="sm" variant={l.level === next ? "default" : "outline"} className="h-7 text-xs" disabled={busy !== null} onClick={() => void call(`h-${l.level}`, () => api.post<{ report: FullView }>(`/api/diagnosis/${view.id}/help`, { level: l.level }))} title={used.has(l.level) ? "Déjà demandé : demander une nouvelle formulation" : undefined}>
                {busy === `h-${l.level}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null} {l.level}. {l.label}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">L&apos;aide va de l&apos;indice à la correction ; elle ne remplace pas votre réflexion. Le niveau 5 suit les règles de l&apos;exercice.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
