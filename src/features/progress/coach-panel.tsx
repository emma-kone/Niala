"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Info, Lightbulb, Loader2, Sparkles, TrendingUp, X, type LucideIcon } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Insight, InsightCategory } from "@/server/domain/coaching";

// Conseils pédagogiques : chaque carte montre sa justification (observations chiffrées) et des actions directes.

export interface CoachReportDto {
  status: "ok" | "insufficient";
  insights: Insight[];
  summary: { gradedAttempts: number; answers: number; activeDays14: number };
  missing: string | null;
}

export const COACH_KEY = ["coaching"] as const;
const META: Record<InsightCategory, { label: string; icon: LucideIcon }> = {
  ADVICE: { label: "Conseil", icon: Lightbulb },
  ACTIVITY: { label: "Activité", icon: ArrowRight },
  PROGRESS: { label: "Progression", icon: TrendingUp },
  ALERT: { label: "Alerte", icon: AlertTriangle },
};
const TONE = { positive: "border-l-emerald-500", neutral: "border-l-primary", warning: "border-l-amber-500" } as const;

export function useCoaching(max = 8) {
  return useQuery({ queryKey: [...COACH_KEY, max], queryFn: () => api.get<CoachReportDto>(`/api/coaching?max=${max}`), staleTime: 30_000 });
}

function InsightCard({ insight, advice, onDismiss, compact }: { insight: Insight; advice?: string; onDismiss: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const meta = META[insight.category];
  return (
    <li className={cn("relative rounded-2xl border-l-4 bg-muted/50 p-3 pr-9", TONE[insight.tone])}>
      <button type="button" aria-label={`Écarter : ${insight.title}`} onClick={onDismiss} className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-background"><X className="h-3.5 w-3.5" aria-hidden /></button>
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><meta.icon className="h-3 w-3" aria-hidden /> {meta.label}</p>
      <p className="mt-0.5 font-medium leading-tight">{insight.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{insight.text}</p>
      {advice && <p className="mt-2 rounded-xl bg-background/70 p-2 text-xs"><span className="font-medium"><Sparkles className="mr-1 inline h-3 w-3" aria-hidden />Conseil de l&apos;IA : </span>{advice}</p>}
      {!compact && (
        <button type="button" className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}><Info className="h-3 w-3" aria-hidden /> Pourquoi ce conseil ?</button>
      )}
      {open && (
        <dl className="mt-1.5 space-y-0.5 text-[11px]">
          {insight.evidence.map((e) => <div key={e.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{e.label}</dt><dd className="font-medium">{e.value}</dd></div>)}
          <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fiabilité</dt><dd className="font-medium">{insight.confidence}</dd></div>
        </dl>
      )}
      {insight.actions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {insight.actions.map((a) => <Button key={a.href} asChild size="sm" variant="outline" className="h-7 rounded-full bg-background px-3 text-xs"><Link href={a.href}>{a.label}</Link></Button>)}
        </div>
      )}
    </li>
  );
}

/** Conseils du moteur pédagogique ; `compact` pour le tableau de bord. */
export function CoachPanel({ max = 8, compact = false }: { max?: number; compact?: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useCoaching(max);
  const advice = useMutation({ mutationFn: () => api.post<{ items: { key: string; advice: string }[]; available: boolean; error?: string }>("/api/coaching/advice") });
  const dismiss = useMutation({ mutationFn: (key: string) => api.request("DELETE", "/api/coaching", { key }), onSuccess: () => void qc.invalidateQueries({ queryKey: COACH_KEY }) });
  const adviceOf = new Map(advice.data?.items.map((i) => [i.key, i.advice]));

  if (isLoading) return <div className="space-y-2" aria-busy><Skeleton className="h-20 rounded-2xl" /><Skeleton className="h-20 rounded-2xl" /></div>;
  if (isError || !data) return <p role="status" className="text-sm text-muted-foreground">Les conseils sont indisponibles pour le moment.</p>;
  return (
    <div className="space-y-3">
      {data.status === "insufficient" && data.missing && <p role="note" className="rounded-2xl bg-muted/50 p-3 text-sm text-muted-foreground">{data.missing}</p>}
      {data.insights.length > 0 && (
        <ul className="space-y-2">
          {data.insights.map((i) => <InsightCard key={i.key} insight={i} compact={compact} advice={adviceOf.get(i.key)} onDismiss={() => dismiss.mutate(i.key)} />)}
        </ul>
      )}
      {data.status === "ok" && data.insights.length === 0 && <p className="text-sm text-muted-foreground">Aucune difficulté particulière ne se dégage de vos derniers exercices. Continuez ainsi.</p>}
      {data.status === "ok" && data.insights.length > 0 && !compact && (
        <div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={advice.isPending} onClick={() => advice.mutate()}>
            {advice.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} Demander l&apos;avis de l&apos;IA
          </Button>
          {advice.data && !advice.data.available && <p className="typo-meta mt-1">Le service d&apos;IA n&apos;est pas configuré.</p>}
          {advice.data?.error && <p role="alert" className="typo-meta mt-1 text-destructive">{advice.data.error}</p>}
          {advice.isError && <p role="alert" className="typo-meta mt-1 text-destructive">L&apos;avis de l&apos;IA n&apos;a pas pu être obtenu.</p>}
          <p className="typo-meta mt-1">L&apos;IA reformule uniquement les observations ci-dessus ; elle n&apos;en ajoute aucune.</p>
        </div>
      )}
    </div>
  );
}
