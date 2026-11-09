"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, GitFork, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { SubjectIcon } from "@/components/subject-icon";
import { routes } from "@/config/routes";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SubjectTabs } from "@/features/subject-files/tabs";
import { NameDialog } from "@/features/subject-files/dialogs";
import type { MapListItem } from "@/features/maps/types";
import { confirmAction } from "@/components/notifications";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);

export default function SubjectMapsView({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState<{ name: string; color: string; icon?: string | null } | null>(null);
  const [maps, setMaps] = useState<MapListItem[] | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [creating, setCreating] = useState<"STRUCTURE" | "CONCEPT" | null>(null);
  const [renaming, setRenaming] = useState<MapListItem | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ maps: MapListItem[] }>(`/api/subjects/${subjectId}/maps`);
      setMaps(r.maps);
      setError(null);
    } catch (e) {
      setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    }
  }, [subjectId]);

  useEffect(() => {
    api.get<{ subject: { name: string; color: string; icon?: string | null } }>(`/api/subjects/${subjectId}`).then((r) => setSubject(r.subject)).catch(() => undefined);
    void load();
  }, [subjectId, load]);

  async function remove(m: MapListItem) {
    if (!(await confirmAction(`Supprimer la carte « ${m.title} » ? Cette action est irréversible.`, { confirmLabel: "Supprimer" }))) return;
    try {
      await api.del(`/api/maps/${m.id}`);
      await load();
    } catch (e) {
      toast({ title: "Suppression impossible", description: errText(e, "Réessayez."), variant: "destructive" });
    }
  }

  if (error?.status === 404) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">Matière introuvable</h1>
        <Button asChild variant="outline" className="mt-6"><Link href={routes.subjects}>Mes matières</Link></Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <nav aria-label="Fil d'Ariane" className="mb-1 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={routes.subjects} className="hover:text-foreground">Mes matières</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={routes.subject(subjectId)} className="hover:text-foreground">{subject?.name ?? "…"}</Link>
      </nav>
      <h1 className="typo-h1 mb-5 flex items-center gap-3">
        {subject && <SubjectIcon icon={subject.icon} name={subject.name} color={subject.color} />}
        {subject?.name ?? <Skeleton className="h-8 w-48" />}
      </h1>
      <SubjectTabs subjectId={subjectId} active="maps" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="typo-subtitle max-w-xl">
          Les cartes sont des graphes que vous pouvez modifier. Générez-en une depuis l&apos;onglet « Analyse » d&apos;un document, ou construisez la vôtre.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setCreating("STRUCTURE")}><GitFork className="h-4 w-4" aria-hidden /> Carte de structure vide</Button>
          <Button className="gap-2" onClick={() => setCreating("CONCEPT")}><Plus className="h-4 w-4" aria-hidden /> Carte conceptuelle vide</Button>
        </div>
      </div>

      {error && <div role="alert" className="mb-3 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error.message}<Button size="sm" variant="outline" onClick={() => void load()}>Réessayer</Button></div>}
      {!maps && !error && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>}
      {maps?.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <Network className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="typo-h3 mt-3">Aucune carte</h2>
          <p className="typo-subtitle mx-auto mt-1 max-w-md">Ouvrez un document, lancez son analyse, puis générez la carte de structure (plan du cours) ou la carte conceptuelle (relations entre notions).</p>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {maps?.map((m) => (
          <li key={m.id} className="group relative rounded-xl border bg-card transition-shadow hover:shadow-md">
            <Link href={`${routes.subject(subjectId)}/cartes/${m.id}`} className="block rounded-xl p-4">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                {m.kind === "STRUCTURE" ? <GitFork className="h-3.5 w-3.5" aria-hidden /> : <Network className="h-3.5 w-3.5" aria-hidden />}
                {m.kind === "STRUCTURE" ? "Structure" : "Conceptuelle"}
              </p>
              <h2 className="typo-h3 mt-1 pr-8">{m.title}</h2>
              <p className="typo-meta mt-2">{m.nodes} nœud(s) · {m.edges} relation(s)</p>
              <p className="typo-meta">Modifiée le {new Date(m.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</p>
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-8 w-8" aria-label={`Actions pour ${m.title}`}>⋮</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenaming(m)}><Pencil className="mr-2 h-4 w-4" aria-hidden /> Renommer</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void remove(m)}><Trash2 className="mr-2 h-4 w-4" aria-hidden /> Supprimer</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
      </ul>

      <NameDialog
        open={!!creating}
        title={creating === "STRUCTURE" ? "Nouvelle carte de structure" : "Nouvelle carte conceptuelle"}
        initial=""
        submitLabel="Créer"
        onClose={() => setCreating(null)}
        onSubmit={async (title) => {
          const r = await api.post<{ id: string }>(`/api/subjects/${subjectId}/maps`, { title, kind: creating });
          setCreating(null);
          router.push(`${routes.subject(subjectId)}/cartes/${r.id}`);
        }}
      />
      <NameDialog
        open={!!renaming}
        title="Renommer la carte"
        initial={renaming?.title ?? ""}
        submitLabel="Renommer"
        onClose={() => setRenaming(null)}
        onSubmit={async (title) => {
          await api.patch(`/api/maps/${renaming!.id}`, { title });
          setRenaming(null);
          await load();
        }}
      />
    </div>
  );
}
