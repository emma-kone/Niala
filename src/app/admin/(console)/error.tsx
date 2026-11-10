"use client";

import { AlertTriangle } from "lucide-react";

// Une erreur dans une rubrique ne fait pas tomber tout le back-office : message compréhensible et nouvel essai.
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-destructive" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold">Cette rubrique n'a pas pu être chargée</h1>
      <p className="mt-1 text-sm text-muted-foreground">Un problème est survenu pendant le calcul des statistiques. Vos données ne sont pas affectées. Réessayez ; si le problème persiste, communiquez la référence ci-dessous à l'équipe technique.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Réf. {error.digest}</p>}
      <button onClick={reset} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Réessayer</button>
    </div>
  );
}
