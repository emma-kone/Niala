"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Pill, priorityTone, statusTone } from "@/components/admin/primitives";
import { confirmAction, notify } from "@/components/notifications";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { MODULES, PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES, type RequestStatus } from "@/server/analytics/definitions";

export interface RequestRowView {
  id: string;
  reference: string;
  type: string;
  subject: string;
  description: string;
  module: string | null;
  priority: string;
  status: string;
  createdAt: string;
  who: string;
  guest: boolean;
  assignee: string;
}

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const td = "px-3 py-2 align-top text-sm";
const btn = "h-8 rounded-lg border px-3 text-sm hover:bg-muted disabled:opacity-50";

/**
 * Liste des demandes : sélection multiple (clôture, changement de statut, suppression) ; chaque ligne s'ouvre sur sa page complète.
 * Les en-têtes triables restent des liens rendus côté serveur (`headers`).
 */
export function RequestsTable({ rows, headers, manage }: { rows: RequestRowView[]; headers: { sortType: React.ReactNode; sortDate: React.ReactNode; sortPriority: React.ReactNode; sortStatus: React.ReactNode }; manage: boolean }) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RequestStatus | "">("");
  const all = rows.length > 0 && picked.length === rows.length;
  const toggle = (id: string, list: string[], set: (v: string[]) => void) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  async function bulk(action: "delete" | "status", next?: RequestStatus) {
    const n = picked.length;
    const text =
      action === "delete"
        ? `Supprimer ${n} demande(s) ? Elles disparaîtront du back-office et de l'espace des demandeurs, mais resteront comptées dans les statistiques.`
        : `Passer ${n} demande(s) à « ${REQUEST_STATUSES[next!]} » ? Chaque demandeur sera informé (notification dans Niala ou e-mail pour un visiteur).`;
    if (!(await confirmAction(text, { title: action === "delete" ? "Supprimer la sélection" : "Changer le statut de la sélection", confirmLabel: action === "delete" ? "Supprimer" : "Confirmer", danger: action === "delete" }))) return;
    setBusy(true);
    try {
      const r = await api.post<{ deleted?: number; updated?: number }>("/api/admin/requests/bulk", { action, ids: picked, ...(next ? { status: next } : {}) });
      notify({ title: action === "delete" ? `${r.deleted ?? 0} demande(s) supprimée(s)` : `${r.updated ?? 0} demande(s) mise(s) à jour`, variant: "success" });
      setPicked([]);
      setStatus("");
      router.refresh();
    } catch (e) {
      notify({ title: "Action impossible", description: e instanceof Error ? e.message : "Réessayez.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {manage && picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2" role="toolbar" aria-label="Actions sur la sélection">
          <span className="text-sm font-medium">{picked.length} sélectionnée(s)</span>
          <button disabled={busy} className={btn} onClick={() => void bulk("status", "RESOLVED")}>Clôturer : résolues</button>
          <button disabled={busy} className={btn} onClick={() => void bulk("status", "REJECTED")}>Clôturer : refusées</button>
          <label className="sr-only" htmlFor="bulk-status">Autre statut</label>
          <select id="bulk-status" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | "")} className="h-8 rounded-lg border bg-background px-2 text-sm">
            <option value="">Autre statut…</option>
            {Object.entries(REQUEST_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {status && <button disabled={busy} className={btn} onClick={() => void bulk("status", status)}>Appliquer</button>}
          <button disabled={busy} className={`${btn} ml-auto border-destructive/40 text-destructive`} onClick={() => void bulk("delete")}>Supprimer</button>
          <button disabled={busy} className={btn} onClick={() => setPicked([])}>Annuler la sélection</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse">
          <thead className="border-b bg-muted/30">
            <tr>
              {manage && <th className={cn(th, "w-8")}><input type="checkbox" aria-label="Tout sélectionner" checked={all} onChange={() => setPicked(all ? [] : rows.map((r) => r.id))} /></th>}
              <th className={th}>Référence</th>
              {headers.sortType}
              <th className={th}>Objet et message</th>
              <th className={th}>Demandeur</th>
              <th className={th}>Module</th>
              {headers.sortDate}
              {headers.sortPriority}
              {headers.sortStatus}
              <th className={th}>Responsable</th>
              <th className={th}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b last:border-0 hover:bg-muted/40", picked.includes(r.id) && "bg-[var(--niala-accent)]/5")}>
                {manage && <td className={td}><input type="checkbox" aria-label={`Sélectionner ${r.reference}`} checked={picked.includes(r.id)} onChange={() => toggle(r.id, picked, setPicked)} /></td>}
                <td className={cn(td, "font-mono text-xs")}><Link className="underline" prefetch href={`/admin/demandes/${r.id}`}>{r.reference}</Link></td>
                <td className={td}>{REQUEST_TYPES[r.type as keyof typeof REQUEST_TYPES] ?? r.type}</td>
                <td className={cn(td, "max-w-[360px]")}>
                  <span className="block font-medium">{r.subject}</span>
                  <span className="block truncate text-xs text-muted-foreground">{r.description}</span>
                </td>
                <td className={cn(td, "max-w-[200px] break-words")}>{r.who}{r.guest && <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">sans compte</span>}</td>
                <td className={td}>{r.module ? (MODULES[r.module as keyof typeof MODULES] ?? r.module) : "—"}</td>
                <td className={cn(td, "whitespace-nowrap")}>{new Date(r.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}</td>
                <td className={td}><Pill tone={priorityTone(r.priority)}>{PRIORITIES[r.priority as keyof typeof PRIORITIES]}</Pill></td>
                <td className={td}><Pill tone={statusTone(r.status)}>{REQUEST_STATUSES[r.status as RequestStatus]}</Pill></td>
                <td className={cn(td, "text-muted-foreground")}>{r.assignee}</td>
                <td className={cn(td, "whitespace-nowrap text-right")}>
                  <Link href={`/admin/demandes/${r.id}`} prefetch aria-label={`Ouvrir la demande ${r.reference}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
                    Ouvrir<ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={manage ? 11 : 10} className="py-10 text-center text-sm text-muted-foreground">Aucune demande ne correspond à ces critères.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
