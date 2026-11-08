"use client";

import { AlertTriangle, CheckCircle2, CircleHelp, FileText, Loader2, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatCitation, ClaimConfidence, ConsultedInfo, VerifiedClaimDto } from "./types";

// Résultat de la vérification serveur : discret quand tout est confirmé, précis quand un point est incertain.

const CONFIDENCE: Record<ClaimConfidence, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  elevee: { label: "Confiance élevée", cls: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400", Icon: CheckCircle2 },
  moderee: { label: "Confiance modérée", cls: "border-sky-500/50 text-sky-700 dark:text-sky-400", Icon: CheckCircle2 },
  faible: { label: "Confiance faible", cls: "border-amber-500/50 text-amber-700 dark:text-amber-300", Icon: AlertTriangle },
  non_verifiee: { label: "Non vérifiée", cls: "border-amber-500/50 text-amber-700 dark:text-amber-300", Icon: CircleHelp },
  contradictoire: { label: "Contradictoire", cls: "border-red-500/50 text-red-700 dark:text-red-400", Icon: Scale },
};

const DOCUMENT_BADGE = { label: "Selon votre document", cls: "border-border text-muted-foreground", Icon: FileText };

function ClaimRow({ claim, citations }: { claim: VerifiedClaimDto; citations: ChatCitation[] }) {
  const badge = claim.basis === "document" ? DOCUMENT_BADGE : CONFIDENCE[claim.confidence];
  const Icon = badge.Icon;
  return (
    <li className="space-y-1 rounded-md border bg-background/50 p-2">
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px]", badge.cls)}>
        <Icon className="h-3 w-3" aria-hidden /> {badge.label}
      </span>
      <p className="text-xs">{claim.text}</p>
      <p className="text-[11px] text-muted-foreground">{claim.reason}</p>
      {claim.limits.length > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">{claim.limits.join(" ")}</p>}
      {claim.evidence.map((e, i) => {
        const source = citations.find((c) => c.n === e.n);
        return (
          <p key={i} className="text-[11px] italic text-muted-foreground">
            <span className="not-italic font-medium">
              [{e.n}] {e.stance === "soutient" ? "confirme" : "contredit"}
              {source?.organization ? ` (${source.organization})` : ""} :
            </span>{" "}
            « {e.quote} »
          </p>
        );
      })}
    </li>
  );
}

export function ReliabilityPanel({ info, citations }: { info: ConsultedInfo | null; citations: ChatCitation[] }) {
  const v = info?.verification;
  if (!v) return null;
  if (v.status === "en_cours") {
    return (
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Réponse pas encore vérifiée : contrôle des sources en cours…
      </p>
    );
  }
  const warnings = v.limits.filter(Boolean);
  const { summary: s } = v;
  const parts = [
    s.elevee ? `${s.elevee} confirmée(s)` : null,
    s.moderee ? `${s.moderee} à confiance modérée` : null,
    s.faible ? `${s.faible} à confiance faible` : null,
    s.non_verifiee ? `${s.non_verifiee} non vérifiée(s)` : null,
    s.contradictoire ? `${s.contradictoire} contradictoire(s)` : null,
    s.document ? `${s.document} selon votre document` : null,
  ].filter(Boolean);
  const concern = s.faible + s.non_verifiee + s.contradictoire > 0;
  if (!warnings.length && !v.claims.length) return null;
  return (
    <div className="mt-2 space-y-1 text-[11px]">
      {warnings.length > 0 && (
        <p className="flex items-start gap-1 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{warnings.join(" ")}</span>
        </p>
      )}
      {v.claims.length > 0 && (
        <details>
          <summary className={cn("cursor-pointer select-none", concern ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
            Fiabilité : {parts.join(" · ")}
          </summary>
          <ul className="mt-1.5 space-y-1.5">
            {v.claims.map((c, i) => (
              <ClaimRow key={i} claim={c} citations={citations} />
            ))}
          </ul>
          <p className="mt-1 text-muted-foreground">Niveaux établis par des règles à partir des passages retrouvés dans les sources. Ce n&apos;est pas une garantie d&apos;exactitude.</p>
        </details>
      )}
    </div>
  );
}
