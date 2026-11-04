"use client";

import { HelpCircle, Microscope, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, type DiagnosisReportDto } from "./types";

const ACTION_TEXT: Record<string, string> = {
  retry: "Corrigez puis relancez : la cause est identifiée.",
  targeted_explanation: "Relisez la règle concernée avant de réessayer (voir l'explication ci-dessus).",
  review_prerequisite: "Vérifiez d'abord la notion de base signalée, puis reprenez cet exercice.",
  clarifying_question: "Une question de vérification permettrait de savoir si la notion est bien comprise.",
  check_environment: "Ce n'est pas une erreur de votre part : l'environnement d'exécution ne fournit pas cette ressource.",
  verify_understanding: "Réussite avec aide : vérifiez que vous pourriez refaire l'exercice sans indice.",
  none: "",
};

const SEVERITY: Record<string, string> = { none: "", low: "Gravité faible", medium: "Gravité moyenne", high: "Gravité élevée" };

/**
 * Diagnostic pédagogique d'une tentative. Distingue ce que les OUTILS ont établi (fait) des pistes à vérifier (hypothèses),
 * et dit franchement quand la cause ne peut pas être déterminée.
 */
export function DiagnosisCard({ report }: { report: DiagnosisReportDto }) {
  if (report.state === "NONE" && !report.needsVerification) return null;
  const uncertain = report.state === "UNCERTAIN";
  const hypothesis = report.needsVerification && !uncertain;
  const Icon = uncertain ? HelpCircle : hypothesis ? Microscope : ShieldCheck;
  const badge = uncertain ? "Cause indéterminée" : hypothesis ? "Piste à vérifier" : report.primary === "ENVIRONMENT" ? "Environnement" : "Constat des outils";
  return (
    <section aria-label="Diagnostic pédagogique" className={cn("mt-4 space-y-2 rounded-lg border p-3 text-sm", hypothesis || uncertain ? "border-amber-500/40 bg-amber-500/5" : "bg-muted/30")}>
      <header className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4" aria-hidden />
        <h3 className="font-semibold">{report.primary ? CATEGORY_LABEL[report.primary] ?? report.primary : "Diagnostic"}</h3>
        <span className="rounded-full border px-2 py-0.5 text-[11px]">{badge}</span>
        {report.severity !== "none" && report.pedagogical && <span className="text-[11px] text-muted-foreground">{SEVERITY[report.severity]}</span>}
        {report.state !== "NONE" && <span className="ml-auto text-[11px] text-muted-foreground">Confiance {Math.round(report.confidence * 100)} %</span>}
      </header>
      <p>{report.summary}</p>
      {report.secondary.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Pistes secondaires : {report.secondary.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")} (hypothèses, non établies).
        </p>
      )}
      {report.evidence.length > 0 && (
        <details open={report.evidence.length <= 3}>
          <summary className="cursor-pointer text-xs font-medium">Preuves observées</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {report.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {report.prerequisites.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Bases à vérifier</p>
          <ul className="list-disc pl-5">
            {report.prerequisites.map((p, i) => (
              <li key={i}>
                <strong>{p.name}</strong> — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ACTION_TEXT[report.recommendedAction] && <p className="text-xs text-muted-foreground">{ACTION_TEXT[report.recommendedAction]}</p>}
    </section>
  );
}
