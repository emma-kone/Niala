"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ClipboardList, FileQuestion, FileText, PenLine, Play, Plus } from "lucide-react";
import { api } from "@/lib/client-api";
import { SubjectIcon } from "@/components/subject-icon";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { EXERCISE_ORIGIN_LABEL } from "@/server/domain/exercise-types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SubjectTabs } from "@/features/subject-files/tabs";
import { exercisesBase, fmtPoints, type ExerciseListItem } from "./types";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const FILTERS: { value: string; label: string }[] = [{ value: "all", label: "Tous" }, { value: "in_progress", label: "En cours" }, { value: "IMPORTED", label: "Sujets importés" }, { value: "FREE", label: "Génération libre" }, { value: "DOCUMENT", label: "Depuis un cours" }];

/** Liste des exercices : d'une matière (onglet) ou de tous (page « Exercices »). */
export default function ExercisesView({ subjectId }: { subjectId?: string }) {
  const qc = useQueryClient();
  const key = ["exercises", subjectId ?? "all"];
  // La liste déjà vue s'affiche aussitôt ; elle est actualisée en arrière-plan.
  const [items, setItems] = useState<ExerciseListItem[] | null>(() => qc.getQueryData<ExerciseListItem[]>(key) ?? null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [subject, setSubject] = useState<{ name: string; color: string; icon?: string | null } | null>(null);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ exercises: ExerciseListItem[] }>(`/api/exercises${subjectId ? `?subjectId=${subjectId}` : ""}`);
      qc.setQueryData(["exercises", subjectId ?? "all"], r.exercises);
      setItems(r.exercises);
      setError(null);
    } catch (e) {
      setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    }
  }, [subjectId, qc]);

  useEffect(() => {
    void load();
    if (subjectId) api.get<{ subject: { name: string; color: string; icon?: string | null } }>(`/api/subjects/${subjectId}`).then((r) => setSubject(r.subject)).catch(() => undefined);
  }, [subjectId, load]);

  const visible = items?.filter((e) => filter === "all" || (filter === "in_progress" ? !!e.inProgress : e.origin === filter));
  const done = items?.filter((e) => e.attempts > 0).length ?? 0;
  const running = items?.filter((e) => e.inProgress).length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {subjectId ? (
        <>
          <nav aria-label="Fil d'Ariane" className="mb-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Link href={routes.subjects} className="hover:text-foreground">Mes matières</Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            <Link href={routes.subject(subjectId)} className="hover:text-foreground">{subject?.name ?? "…"}</Link>
          </nav>
          <h1 className="typo-h1 mb-5 flex items-center gap-3">
            {subject && <SubjectIcon icon={subject.icon} name={subject.name} color={subject.color} />}
            {subject?.name ?? <Skeleton className="h-8 w-48" />}
          </h1>
          <SubjectTabs subjectId={subjectId} active="exercises" />
        </>
      ) : (
        <>
          <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="typo-h1">Exercices</h1>
              <p className="typo-subtitle mt-1">{items && items.length > 0 ? `${items.length} exercice(s) · ${done} commencé(s)${running ? ` · ${running} en cours` : ""}` : "Créez un exercice en quelques secondes, avec ou sans document."}</p>
            </div>
            <Button asChild className="gap-1.5"><Link href={routes.newExercise}><Plus className="h-4 w-4" aria-hidden /> Créer un exercice</Link></Button>
          </header>
          {items?.length === 0 && (
            <section aria-label="Points de départ" className="mb-6 grid gap-3 sm:grid-cols-3">
              {[
                { source: "free", title: "Génération libre", text: "Indiquez une matière et un thème.", icon: PenLine },
                { source: "course", title: "Depuis un cours", text: "Importez votre cours.", icon: FileText },
                { source: "import", title: "Reproduire un sujet", text: "Résolvez un TD ou un examen ici.", icon: FileQuestion },
              ].map((s) => (
                <Link key={s.source} href={`${routes.newExercise}?source=${s.source}`} className="flex items-start gap-3 rounded-3xl border bg-card p-4 transition-colors hover:bg-muted/40">
                  <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span><span className="block font-semibold">{s.title}</span><span className="typo-meta">{s.text}</span></span>
                </Link>
              ))}
            </section>
          )}
          {items && items.length > 0 && (
            <div role="group" aria-label="Filtrer les exercices" className="mb-4 flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", filter === f.value ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted")}>{f.label}</button>
              ))}
            </div>
          )}
        </>
      )}

      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
          <Button size="sm" variant="outline" onClick={() => void load()}>Réessayer</Button>
        </div>
      )}
      {!items && !error && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>}
      {items?.length === 0 && subjectId && (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="typo-h3 mt-3">Aucun exercice</h2>
          <p className="typo-subtitle mx-auto mt-1 max-w-md">Ouvrez un de vos documents et choisissez « Créer un exercice » : les questions sont fondées uniquement sur ce document, avec le barème et les types que vous choisissez.</p>
        </div>
      )}
      {visible?.length === 0 && items!.length > 0 && <p className="typo-subtitle py-8 text-center">Aucun exercice dans cette catégorie.</p>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible?.map((e) => {
          const base = exercisesBase(e.subject?.id);
          return (
            <li key={e.id} className="rounded-xl border bg-card p-4 transition-shadow hover:shadow-md">
              <Link href={`${base}/${e.id}`} className="block">
                {!subjectId && (
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    {e.subject ? <><SubjectIcon icon={e.subject.icon} name={e.subject.name} color={e.subject.color} size="xs" /> {e.subject.name}</> : (e.freeSubject ?? EXERCISE_ORIGIN_LABEL[e.origin])}
                  </p>
                )}
                <h2 className="typo-h3">{e.title}</h2>
                {e.document && <p className="typo-meta mt-1 flex items-center gap-1"><FileText className="h-3 w-3" aria-hidden /> {e.document.name}{e.versionNumber ? ` · v${e.versionNumber}` : ""}</p>}
                <p className="typo-meta mt-2">{e.questions} question(s) · {fmtPoints(e.totalPoints)} points</p>
                <p className="typo-meta">
                  {e.attempts === 0 ? "Jamais tenté" : `${e.attempts} tentative(s)${e.best != null ? ` · meilleur score ${fmtPoints(e.best)} / ${fmtPoints(e.totalPoints)}` : ""}`}
                </p>
              </Link>
              {e.inProgress && (
                <Button asChild size="sm" className="mt-3 gap-1.5"><Link href={`${base}/${e.id}/tentatives/${e.inProgress}`}><Play className="h-4 w-4" aria-hidden /> Reprendre</Link></Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
