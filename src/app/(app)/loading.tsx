import { Skeleton } from "@/components/ui/skeleton";

/** Structure affichée immédiatement à chaque changement de module, pendant le chargement de la page. */
export default function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6" aria-busy>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36 rounded-3xl" />
        <Skeleton className="h-36 rounded-3xl" />
        <Skeleton className="h-36 rounded-3xl" />
      </div>
    </div>
  );
}
