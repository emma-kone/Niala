"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Maximize2, Minimize2, Save } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { notify, confirmAction } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ENVIRONMENTS, isEnvironment } from "@/workspaces/registry";
import type { WorkspaceProps } from "./types";

// Chaque environnement est un composant indépendant, chargé à la demande : ajouter une discipline revient à ajouter
// une entrée ici (et au registre), sans toucher au moteur d'exercices.
const loading = () => <Skeleton className="h-72 w-full rounded-2xl" aria-busy />;
const COMPONENTS: Record<string, React.ComponentType<WorkspaceProps>> = {
  merise: dynamic(() => import("./merise/workshop"), { ssr: false, loading }),
  math: dynamic(() => import("./math/math-workspace"), { ssr: false, loading }),
  algo: dynamic(() => import("./algo/algo-workspace"), { ssr: false, loading }),
};

/** Cadre commun des ateliers : consigne visible, outils, agrandissement, versions de la production. */
export function WorkspaceHost({ attemptId, position, statement, payload, value, onChange, disabled }: { attemptId: string; position: number; statement: React.ReactNode; payload: Record<string, unknown>; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const env = payload.environment;
  const [full, setFull] = useState(false);
  const qc = useQueryClient();
  const key = ["revisions", attemptId, position];
  const { data, refetch } = useQuery({ queryKey: key, queryFn: () => api.get<{ revisions: { number: number; createdAt: string }[] }>(`/api/attempts/${attemptId}/answers/${position}/revisions`).then((r) => r.revisions), enabled: false });
  const Env = isEnvironment(env) ? COMPONENTS[env] : undefined;
  if (!Env || !isEnvironment(env)) return <p role="alert" className="text-sm text-destructive">Cet atelier n&apos;est pas disponible dans cette version de Niala.</p>;
  const info = ENVIRONMENTS[env];

  async function checkpoint() {
    try {
      await api.post(`/api/attempts/${attemptId}/answers/${position}/revisions`);
      void qc.invalidateQueries({ queryKey: key });
      notify({ title: "Point de restauration créé", variant: "success", durationMs: 2500 });
    } catch (e) {
      notify({ title: "Création impossible", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }
  async function restore(n: number) {
    if (!(await confirmAction("Revenir à cette version ? Votre travail actuel est conservé comme version.", { confirmLabel: "Restaurer", danger: false }))) return;
    try {
      await api.post(`/api/attempts/${attemptId}/answers/${position}/revisions`);
      const r = await api.get<{ data: unknown }>(`/api/attempts/${attemptId}/answers/${position}/revisions/${n}`);
      onChange(r.data);
      void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      notify({ title: "Restauration impossible", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  return (
    <div className={cn("space-y-3", full && "fixed inset-0 z-50 overflow-y-auto bg-background p-4 sm:p-6")}>
      {full && <div className="mx-auto max-w-5xl text-base font-semibold leading-relaxed">{statement}</div>}
      <div className={cn("space-y-2", full && "mx-auto max-w-5xl")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium">{info.label}</span>
          <span className="text-xs text-muted-foreground">Enregistrement automatique · {((payload.deliverables as string[] | undefined) ?? info.deliverables).join(", ")}</span>
          <span className="ml-auto flex gap-1.5">
            {!disabled && (
              <DropdownMenu onOpenChange={(o) => o && void refetch()}>
                <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" className="gap-1.5"><History className="h-4 w-4" aria-hidden /> Versions</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                  <DropdownMenuItem onSelect={() => void checkpoint()}><Save className="mr-2 h-4 w-4" aria-hidden /> Créer un point de restauration</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Revenir à…</DropdownMenuLabel>
                  {!data && <p className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Chargement…</p>}
                  {data?.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Aucune version pour l&apos;instant.</p>}
                  {data?.map((r) => <DropdownMenuItem key={r.number} onSelect={() => void restore(r.number)}>Version {r.number} · {new Date(r.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button type="button" variant="outline" size="sm" className="gap-1.5" aria-pressed={full} onClick={() => setFull(!full)}>{full ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />} {full ? "Réduire" : "Agrandir"}</Button>
          </span>
        </div>
        <Env value={value} onChange={onChange} disabled={disabled} payload={payload} />
      </div>
    </div>
  );
}
