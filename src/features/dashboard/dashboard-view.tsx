"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, BookOpen, FlaskConical, GraduationCap, History, Play } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ACTION_LABEL, evidenceLabel, pct, recommendationHref, type DashboardData, type Recommendation } from "@/features/progress/types";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const ago = (d: string | null) => {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
};
const KIND_LABEL: Record<string, string> = { exercise: "Exercice", lab_code: "Code", lab_sql: "SQL" };

export default function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<DashboardData>("/api/dashboard"));
      setError(null);
    } catch (e) {
      setError(errText(e, "Chargement impossible."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(r: Recommendation) {
    try {
      await api.patch(`/api/recommendations/${r.id}`, { status: "DISMISSED" });
      void load();
    } catch (e) {
      setError(errText(e, "Action impossible."));
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">Tableau de bord indisponible</h1>
        <p className="typo-subtitle mt-2">{error}</p>
        <Button className="mt-6" variant="outline" onClick={() => void load()}>Réessayer</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-busy>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-36 rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-44 rounded-xl" /><Skeleton className="h-44 rounded-xl" /></div>
      </div>
    );
  }

  if (!data.hasData) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <GraduationCap className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="typo-h2 mt-3">Bienvenue sur Niala</h1>
        <p className="typo-subtitle mt-2">Créez votre première matière et importez-y vos cours : le tableau de bord se construira avec votre travail réel.</p>
        <Button asChild className="mt-6"><Link href={routes.subjects}>Créer une matière</Link></Button>
      </div>
    );
  }

  const next = data.next;
  const nextHref = next ? recommendationHref(next) : null;
  const others = data.recommendations.filter((r) => r.id !== next?.id);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="typo-h1">Tableau de bord</h1>

      <section aria-label="Prochaine activité" className="mt-4 rounded-xl border bg-card p-5">
        <h2 className="typo-h3 mb-3">Quelle prochaine activité ?</h2>
        {!data.resume && !next ? (
          <p className="typo-subtitle">Rien de particulier à faire. Ouvrez un cours, faites un exercice ou un laboratoire : des suggestions apparaîtront selon vos résultats réels.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {data.resume && (
              <div className="rounded-lg border p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reprendre là où vous en étiez</p>
                <p className="mt-1 font-medium">{data.resume.title}</p>
                <p className="text-xs text-muted-foreground">{data.resume.type === "READING" ? "Lecture" : data.resume.type === "EXERCISE" ? "Exercice" : "Laboratoire"} · {ago(data.resume.updatedAt)}</p>
                {data.resume.href && <Button asChild className="mt-3 gap-2"><Link href={data.resume.href}><Play className="h-4 w-4" aria-hidden /> Reprendre</Link></Button>}
              </div>
            )}
            {next && (
              <div className="rounded-lg border border-primary/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Suggestion</p>
                <p className="mt-1 font-medium">{next.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{next.text}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {nextHref && <Button asChild className="gap-2"><Link href={nextHref}>{ACTION_LABEL[next.type]} <ArrowRight className="h-4 w-4" aria-hidden /></Link></Button>}
                  <Button variant="ghost" onClick={() => void dismiss(next)}>Pas maintenant</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <section aria-label="Où j'en suis" className="lg:col-span-2">
          <h2 className="typo-h3 mb-2">Où j&apos;en suis ?</h2>
          <ul className="space-y-3">
            {data.subjects.map((s) => (
              <li key={s.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                  <Link href={routes.subject(s.id)} className="font-medium hover:underline">{s.name}</Link>
                  <span className="ml-auto text-xs text-muted-foreground">{s.documents} fichier(s) · {s.exercises} exercice(s) · {s.notes} note(s)</span>
                </div>
                {s.mastery === null ? (
                  <p className="mt-2 text-sm text-muted-foreground">{s.concepts.total === 0 ? "Aucune notion identifiée : analysez un cours pour suivre votre maîtrise." : `Pas assez de données : ${s.concepts.total} notion(s) identifiée(s), aucune mesurée. Faites un exercice sur ce cours.`}</p>
                ) : (
                  <div className="mt-2">
                    <div className="flex items-center gap-3">
                      <Progress value={s.mastery * 100} className="h-2 flex-1" aria-label={`Maîtrise estimée de ${s.name}`} />
                      <span className="w-14 text-right text-sm font-semibold">{pct(s.mastery)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Maîtrise estimée sur {s.concepts.measured} notion(s) mesurée(s) sur {s.concepts.total} ({evidenceLabel(s.confidence)}) · {s.concepts.fragile} fragile(s) · {s.concepts.solid} solide(s). Ce n&apos;est pas une note.
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-5">
          <section aria-label="À surveiller">
            <h2 className="typo-h3 mb-2">Qu&apos;est-ce qui demande mon attention ?</h2>
            {data.attention.length === 0 ? (
              <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Rien d&apos;urgent.</p>
            ) : (
              <ul className="space-y-2">
                {data.attention.map((a, i) => (
                  <li key={i} className="flex gap-2 rounded-xl border bg-card p-3 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <span>{a.href ? <Link href={a.href} className="hover:underline">{a.text}</Link> : a.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {others.length > 0 && (
            <section aria-label="Autres suggestions">
              <h2 className="typo-h3 mb-2">Autres suggestions</h2>
              <ul className="space-y-2">
                {others.map((r) => {
                  const href = recommendationHref(r);
                  return (
                    <li key={r.id} className="rounded-xl border bg-card p-3 text-sm">
                      <p className="font-medium">{r.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.text}</p>
                      <div className="mt-2 flex gap-2">
                        {href && <Button asChild size="sm" variant="outline"><Link href={href}>{ACTION_LABEL[r.type]}</Link></Button>}
                        <Button size="sm" variant="ghost" onClick={() => void dismiss(r)}>Écarter</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </aside>
      </div>

      <section aria-label="Activité récente" className="mt-6">
        <h2 className="typo-h3 mb-2 flex items-center gap-2"><History className="h-4 w-4" aria-hidden /> Activité récente</h2>
        {data.recent.length === 0 ? (
          <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Aucune activité pour l&apos;instant.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {data.recent.map((r, i) => (
              <li key={i}>
                <Link href={r.href ?? "#"} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50">
                  {r.kind === "exercise" ? <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden /> : <FlaskConical className="h-4 w-4 text-muted-foreground" aria-hidden />}
                  <span className="font-medium">{r.title}</span>
                  <span className="text-xs text-muted-foreground">{KIND_LABEL[r.kind]} · {ago(r.at)}</span>
                  {r.detail && <span className="ml-auto font-semibold">{r.detail}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <Alert variant="destructive" className="mt-4"><AlertTitle>Erreur</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  );
}
