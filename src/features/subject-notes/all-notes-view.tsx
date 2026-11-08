"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NotebookPen } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Group {
  subject: { id: string; name: string; color: string };
  notes: { id: string; title: string; updatedAt: string }[];
}

/** Toutes les notes, regroupées par matière. La création et l'édition restent dans l'espace de chaque matière. */
export default function AllNotesView() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ groups: Group[] }>("/api/notes").then((r) => setGroups(r.groups)).catch((e) => setError(e instanceof Error ? e.message : "Chargement impossible."));
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="typo-h1">Notes</h1>
      <p className="typo-subtitle mt-1">Choisissez une matière pour écrire une note ou reprendre l&apos;une des vôtres.</p>
      {error && <p className="mt-6 text-sm text-destructive" role="alert">{error}</p>}
      {!groups && !error && <Skeleton className="mt-6 h-48 rounded-3xl" aria-busy />}
      {groups?.length === 0 && (
        <div className="mt-6 rounded-3xl border p-10 text-center">
          <NotebookPen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">Créez d&apos;abord une matière</p>
          <Button asChild className="mt-4 rounded-full"><Link href={routes.subjects}>Mes matières</Link></Button>
        </div>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {groups?.map((g) => (
          <section key={g.subject.id} aria-label={g.subject.name} className="rounded-3xl border bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: g.subject.color }} aria-hidden /> {g.subject.name}</h2>
              <Button asChild size="sm" variant="outline" className="rounded-full"><Link href={`${routes.subject(g.subject.id)}/notes`}>Ouvrir</Link></Button>
            </div>
            {g.notes.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Aucune note pour l&apos;instant.</p> : (
              <ul className="mt-3 space-y-1">
                {g.notes.map((n) => (
                  <li key={n.id}><Link href={`${routes.subject(g.subject.id)}/notes`} className="block truncate rounded-xl px-3 py-1.5 text-sm hover:bg-muted">{n.title || "Sans titre"}</Link></li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
