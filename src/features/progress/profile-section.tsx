"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Compass, History, Repeat2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { Skeleton } from "@/components/ui/skeleton";
import type { LearningProfileDto, ProfileConceptDto } from "./types";

const fmt = (d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
const ACTIVITY: Record<string, string> = { CODE: "Code", SQL: "SQL", EXERCISE: "Exercice" };

function Names({ list, empty }: { list: ProfileConceptDto[]; empty: string }) {
  if (!list.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5">
      {list.slice(0, 4).map((c) => (
        <li key={c.id} className="text-sm">
          <span className="font-medium">{c.name}</span> <span className="text-xs text-muted-foreground">· {c.subjectName}</span>
          {c.reasons[0] && <span className="block text-xs text-muted-foreground">{c.reasons[0]}</span>}
        </li>
      ))}
      {list.length > 4 && <li className="text-xs text-muted-foreground">et {list.length - 4} autre(s)…</li>}
    </ul>
  );
}

/** Profil pédagogique : l'essentiel, sans tableau de statistiques. Tout renvoie à des observations ; les pistes sont des hypothèses. */
export function ProfileSection() {
  const [profile, setProfile] = useState<LearningProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ profile: LearningProfileDto }>("/api/progress/profile")
      .then((r) => !cancelled && setProfile(r.profile))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Profil indisponible."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;
  if (!profile) return <Skeleton className="mt-5 h-40 rounded-xl" />;
  if (!profile.hasData) return null;

  return (
    <section aria-label="Profil pédagogique" className="mt-5 space-y-3">
      <div>
        <h2 className="typo-h3">Votre profil d&apos;apprentissage</h2>
        <p className="text-xs text-muted-foreground">
          Construit à partir de vos exercices, de votre code et de vos requêtes. Ce sont des observations et des pistes à vérifier, jamais un jugement.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden /> À travailler
          </h3>
          <Names list={profile.fragile} empty="Aucune notion fragile mesurée pour l'instant." />
          {profile.recheck.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                <History className="h-3.5 w-3.5" aria-hidden /> À revérifier (acquises il y a longtemps)
              </p>
              <Names list={profile.recheck} empty="" />
            </div>
          )}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Repeat2 className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden /> Difficultés qui reviennent
          </h3>
          {profile.recurring.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune difficulté récurrente détectée : les erreurs observées restent isolées.</p>
          ) : (
            <ul className="space-y-2">
              {profile.recurring.slice(0, 3).map((r) => (
                <li key={r.skill} className="text-sm">
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.statement}</span>
                  {r.note && <span className="block text-xs italic text-muted-foreground">{r.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> Vos acquis
          </h3>
          <Names list={profile.overcome.length ? profile.overcome : profile.mastered} empty="Pas encore de notion maîtrisée sur plusieurs observations sûres." />
          {profile.overcome.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Anciennes difficultés dépassées.</p>}
          {profile.toDiscoverCount > 0 && <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">{profile.toDiscoverCount} notion(s) ont trop peu d&apos;observations pour être jugées.</p>}
        </div>
      </div>
      {profile.recent.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Compass className="h-4 w-4" aria-hidden /> Derniers diagnostics
          </h3>
          <ul className="space-y-1.5">
            {profile.recent.slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">{fmt(r.at)}</span>
                <span className="w-16 shrink-0 text-xs">{ACTIVITY[r.activity] ?? r.activity}</span>
                <span className="min-w-0 flex-1">
                  {r.uncertain ? "Cause indéterminée" : (r.categoryLabel ?? "Diagnostic")}
                  <span className="text-muted-foreground"> — {r.summary.slice(0, 110)}{r.summary.length > 110 ? "…" : ""}</span>
                </span>
                {r.needsVerification && <span className="text-[11px] text-amber-700 dark:text-amber-300">à vérifier</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Pour comprendre une erreur ou demander de l&apos;aide, ouvrez la correction correspondante.{" "}
            <Link className="underline" href="/assistant">
              Demander à l&apos;assistant
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}
