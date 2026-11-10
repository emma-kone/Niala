"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { confirmAction, notify } from "@/components/notifications";
import { api } from "@/lib/client-api";

export function ResolveAlertButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      className="rounded-lg border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
      onClick={async () => {
        if (!(await confirmAction("Marquer cette alerte comme résolue ? Elle sera réouverte automatiquement si le problème persiste.", { title: "Résoudre l'alerte", confirmLabel: "Résoudre" }))) return;
        setBusy(true);
        try {
          await api.post(`/api/admin/alerts/${id}/resolve`, {});
          router.refresh();
        } catch (e) {
          notify({ title: "Action impossible", description: e instanceof Error ? e.message : undefined, variant: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      Marquer comme résolue
    </button>
  );
}

export function BackfillButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      onClick={async () => {
        if (!(await confirmAction("Reconstituer l'historique d'événements à partir des tables existantes ? L'opération est rejouable sans doublon ; les événements reconstitués sont marqués comme tels.", { title: "Reconstituer l'historique", confirmLabel: "Lancer" }))) return;
        setBusy(true);
        try {
          const r = await api.post<{ results: { type: string; inserted: number }[] }>("/api/admin/backfill", {});
          const total = r.results.reduce((s, x) => s + x.inserted, 0);
          notify({ title: "Historique reconstitué", description: `${total} événement(s) ajouté(s).`, variant: "success" });
          router.refresh();
        } catch (e) {
          notify({ title: "Reconstitution impossible", description: e instanceof Error ? e.message : undefined, variant: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Reconstitution en cours…" : "Reconstituer l'historique"}
    </button>
  );
}
