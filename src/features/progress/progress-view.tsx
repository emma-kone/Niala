"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/client-api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_LABEL } from "@/features/labs/types";
import { cn } from "@/lib/utils";
import { pct, type ConceptDetail, type ProgressConcept, type ProgressData } from "./types";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const BAND_CLASS: Record<ProgressConcept["band"], string> = {
  unknown: "text-muted-foreground",
  fragile: "text-red-700 dark:text-red-400",
  developing: "text-amber-700 dark:text-amber-400",
  to_confirm: "text-emerald-700 dark:text-emerald-400",
  solid: "text-emerald-700 dark:text-emerald-400",
};
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "");

export default function ProgressView() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<ProgressData>("/api/progress"));
      setError(null);
    } catch (e) {
      setError(errText(e, "Chargement impossible."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function recompute() {
    setBusy(true);
    try {
      await api.post("/api/progress/recompute");
      await load();
    } catch (e) {
      setError(errText(e, "Recalcul impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    setDetail(null);
    setDetailError(null);
    try {
      setDetail(await api.get<ConceptDetail>(`/api/progress/concepts/${id}`));
    } catch (e) {
      setDetailError(errText(e, "Détail indisponible."));
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">Progression indisponible</h1>
        <p className="typo-subtitle mt-2">{error}</p>
        <Button className="mt-6" variant="outline" onClick={() => void load()}>Réessayer</Button>
      </div>
    );
  }
  if (!data) return <div className="mx-auto max-w-5xl space-y-3 px-4 py-6" aria-busy><Skeleton className="h-9 w-56" /><Skeleton className="h-64 rounded-xl" /></div>;

  const bySubject = new Map<string, ProgressConcept[]>();
  for (const c of data.concepts) bySubject.set(c.subjectName, [...(bySubject.get(c.subjectName) ?? []), c]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="typo-h1 mr-auto">Progression</h1>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void recompute()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />} Recalculer
        </Button>
      </div>
      <p className="typo-subtitle mt-1">
        La maîtrise est estimée <strong>par notion</strong> à partir de vos réponses corrigées et de vos tests de laboratoire, avec un niveau de confiance. Une note d&apos;exercice n&apos;est pas une mesure de maîtrise.
      </p>

      <section aria-label="Maîtrise par notion" className="mt-5 space-y-5">
        {data.concepts.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune notion pour l&apos;instant. Analysez un cours (onglet Analyse du lecteur) puis faites des exercices : votre maîtrise apparaîtra ici.</p>
        ) : (
          [...bySubject.entries()].map(([subject, list]) => (
            <div key={subject}>
              <h2 className="typo-h3 mb-2">{subject}</h2>
              <ul className="divide-y rounded-xl border bg-card">
                {list.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => void toggle(c.id)} aria-expanded={open === c.id} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40">
                      <span className="min-w-0 flex-1 font-medium">{c.name}</span>
                      {c.band === "unknown" ? (
                        <span className="text-xs text-muted-foreground">{c.evidenceCount} réponse(s) corrigée(s)</span>
                      ) : (
                        <>
                          <Progress value={c.level * 100} className="h-2 w-28" aria-label={`Maîtrise de ${c.name}`} />
                          <span className="w-12 text-right font-semibold">{pct(c.level)}</span>
                        </>
                      )}
                      <Badge variant="outline" className={cn("font-normal", BAND_CLASS[c.band])}>{c.bandLabel}</Badge>
                      <span className="w-24 text-right text-xs text-muted-foreground">confiance {pct(c.confidence)}</span>
                    </button>
                    {open === c.id && (
                      <div className="border-t bg-muted/30 px-4 py-3 text-sm">
                        {detailError ? <p role="alert" className="text-destructive">{detailError}</p> : !detail ? <Skeleton className="h-16" /> : (
                          <div className="space-y-2">
                            {c.prerequisites.length > 0 && <p className="text-xs">Prérequis : {c.prerequisites.map((p) => p.name).join(", ")}</p>}
                            {detail.evidence.length === 0 ? <p className="text-muted-foreground">Aucune preuve : aucun exercice corrigé ne porte encore sur cette notion.</p> : (
                              <ul className="space-y-1">
                                {detail.evidence.map((e, i) => (
                                  <li key={i} className="flex flex-wrap gap-2 text-xs">
                                    <Badge variant="outline" className="font-normal">{e.kind === "lab" ? "Laboratoire" : "Exercice"}</Badge>
                                    <span className="font-medium">{e.label}</span>
                                    <span className="text-muted-foreground">{fmt(e.at)} · poids {e.weight}</span>
                                    <span className="ml-auto font-semibold">{pct(e.score)} réussi</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <p className="text-xs text-muted-foreground">{detail.howItIsComputed}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-label="Notes d'exercices" className="mt-8">
        <h2 className="typo-h3 mb-1">Résultats aux exercices</h2>
        <p className="typo-subtitle mb-2">Notes brutes, présentées à part : elles dépendent de la difficulté de chaque exercice.</p>
        {data.attempts.length === 0 ? <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Aucun exercice corrigé.</p> : (
          <ul className="divide-y rounded-xl border bg-card">
            {[...data.attempts].reverse().slice(0, 12).map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                {a.subject && <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.subject.color }} aria-hidden />}
                <span className="font-medium">{a.title}</span>
                <span className="text-xs text-muted-foreground">{fmt(a.at)}</span>
                <span className="ml-auto font-semibold">{a.percentage != null ? `${a.percentage} %` : "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Erreurs fréquentes" className="mt-8">
        <h2 className="typo-h3 mb-1">Erreurs repérées (30 derniers jours)</h2>
        <p className="typo-subtitle mb-2">Diagnostic établi à partir des tests exécutés (syntaxe, logique, consigne…). {data.hypotheses > 0 && `${data.hypotheses} hypothèse(s) de l'IA (notion, méthode…) non comptées : ce sont des suppositions.`}</p>
        {data.errors.length === 0 ? <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Aucune erreur diagnostiquée.</p> : (
          <ul className="flex flex-wrap gap-2">{data.errors.map((e) => <li key={e.category}><Badge variant="outline" className="px-3 py-1 text-sm font-normal">{CATEGORY_LABEL[e.category] ?? e.category} · {e.count}</Badge></li>)}</ul>
        )}
      </section>
      <p className="mt-6 text-xs text-muted-foreground">Les sessions de l&apos;ancienne version restent conservées dans la base mais ne sont plus affichées. <Link className="underline" href="/matieres">Mes matières</Link></p>
      {error && <Alert variant="destructive" className="mt-4"><AlertTitle>Erreur</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  );
}
