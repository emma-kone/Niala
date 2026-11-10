// État de chargement des rubriques : l'ossature s'affiche aussitôt, les chiffres arrivent ensuite.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-label="Chargement de la rubrique" className="animate-pulse">
      <div className="mb-6 h-8 w-64 rounded-lg bg-muted" />
      <div className="mb-8 h-4 w-96 max-w-full rounded bg-muted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-28 rounded-2xl border bg-card" />)}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="h-72 rounded-2xl border bg-card" />
        <div className="h-72 rounded-2xl border bg-card" />
      </div>
      <span className="sr-only">Chargement en cours…</span>
    </div>
  );
}
