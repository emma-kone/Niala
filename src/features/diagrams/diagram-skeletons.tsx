import { Skeleton } from "@/components/ui/skeleton";
import { LabListSkeleton } from "@/features/labs/lab-skeletons";

// Formes de préchargement du laboratoire de diagrammes : mêmes conteneurs et mêmes dimensions que les pages réelles.

/** Accueil : titre, carte de création (deux types de diagramme), puis la liste. */
export function DiagramHomeSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6" aria-busy aria-label="Chargement du laboratoire de diagrammes">
      <Skeleton className="h-8 w-72" />
      <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
      <div className="mt-5 rounded-xl border bg-card p-4">
        <Skeleton className="h-5 w-40" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="mb-2 mt-8 h-6 w-52" />
      <LabListSkeleton />
    </div>
  );
}

/** Espace de travail : titre, canevas avec sa barre d'outils à gauche, onglets (assistant, sujet, vérifier) à droite. */
export function DiagramWorkspaceSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pt-6 pb-6 sm:px-6" aria-busy aria-label="Chargement du diagramme">
      <Skeleton className="mb-2 h-4 w-60" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Skeleton className="mr-auto h-9 w-80 max-w-full" />
        <Skeleton className="h-6 w-40 rounded-full" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap gap-1 border-b p-2">
            {[96, 80, 76, 104, 68].map((w, i) => <Skeleton key={i} className="h-8" style={{ width: w }} />)}
          </div>
          <Skeleton className="h-[68vh] min-h-[460px] rounded-none opacity-40" />
          <div className="border-t px-3 py-1.5"><Skeleton className="h-3 w-3/4" /></div>
        </div>
        <div>
          <Skeleton className="h-9 w-full rounded-lg" />
          <div className="mt-2 h-[calc(68vh+5.5rem)] min-h-[520px] rounded-xl border bg-card p-4">
            <Skeleton className="mx-auto mt-4 h-6 w-6 rounded-full" />
            <Skeleton className="mx-auto mt-3 h-4 w-48" />
            <Skeleton className="mx-auto mt-2 h-3 w-64" />
          </div>
        </div>
      </div>
    </div>
  );
}
