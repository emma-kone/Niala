import { Skeleton } from "@/components/ui/skeleton";

// Formes de préchargement des laboratoires : elles reprennent les dimensions et la disposition de ce qui s'affiche ensuite
// (mêmes conteneurs, mêmes marges, mêmes lignes), pour que la page ne « saute » pas quand le contenu arrive.

/** Liste « Mes espaces de travail » : un seul cadre à lignes séparées, comme la liste réelle. */
export function LabListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="divide-y rounded-xl border bg-card" aria-busy aria-label="Chargement des espaces de travail">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-5 w-56 max-w-full" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-3.5 w-14" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          </div>
          <Skeleton className="h-8 w-24" />
        </li>
      ))}
    </ul>
  );
}

/** Page d'accueil d'un laboratoire : titre, deux cartes de création, puis la liste. */
export function LabHomeSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6" aria-busy>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-2 h-4 w-full max-w-xl" />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mb-3 mt-2 h-4 w-full max-w-xs" />
            <div className="flex flex-wrap items-end gap-2">
              <Skeleton className="h-9 w-44" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="mb-2 mt-8 h-6 w-52" />
      <LabListSkeleton />
    </div>
  );
}

/** Espace de travail : fil d'Ariane, en-tête, éditeur et boutons à gauche, panneau de résultat à droite. */
export function LabWorkspaceSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-6 pb-6 sm:px-6" aria-busy aria-label="Chargement de l'espace de travail">
      <Skeleton className="mb-2 h-4 w-52" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton className="mr-auto h-8 w-72 max-w-full" />
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <Skeleton className="h-[360px] rounded-xl" />
          <Skeleton className="h-10 rounded-md" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-36" />
          </div>
        </div>
        <div className="min-w-0 rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-3 h-4 w-5/6" />
          <Skeleton className="mt-6 h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
