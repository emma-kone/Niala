import { Notice, PageHeader, Pagination, Panel, Pill, statusTone, Table, Td, Th } from "@/components/admin/primitives";
import { fmtDateTime } from "@/components/admin/format";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { AUDIT_PAGE_SIZE, listAudit } from "@/server/admin/audit-log";
import { requireAdminPage } from "@/server/admin/session";
import { flat, keep, type SP } from "../_lib";
import Link from "next/link";

const RESULT = { SUCCESS: "Réussi", DENIED: "Refusé", FAILED: "Échec" } as const;

/** Détail lisible : jamais de contenu privé, seulement des identifiants techniques et des valeurs administratives. */
function detailText(d: unknown): string {
  if (!d || typeof d !== "object") return "";
  return Object.entries(d as Record<string, unknown>)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k} : ${Array.isArray(v) ? v.join(" → ") : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage("audit.view");
  const q = await flat(searchParams);
  const res = await listAudit(q);
  const base = keep(q);
  const sel = "h-9 w-full rounded-lg border bg-background px-2 text-sm";

  return (
    <>
      <PageHeader title="Journal d'activité" description="Opérations effectuées dans le back-office : qui, quoi, quand, sur quel objet, avec quel résultat. Le journal est en lecture seule et protégé contre toute modification." />
      <Panel className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtrer le journal">
          <label className="text-xs text-muted-foreground">Action<select name="action" defaultValue={q.action ?? ""} className={`${sel} mt-1`}><option value="">Toutes</option>{Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Résultat<select name="result" defaultValue={q.result ?? ""} className={`${sel} mt-1`}><option value="">Tous</option>{Object.entries(RESULT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Administrateur<input name="actor" defaultValue={q.actor} placeholder="e-mail" className={`${sel} mt-1`} /></label>
          <label className="text-xs text-muted-foreground">Du<input type="date" name="from" defaultValue={q.from} className={`${sel} mt-1`} /></label>
          <label className="text-xs text-muted-foreground">Au<input type="date" name="to" defaultValue={q.to} className={`${sel} mt-1`} /></label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5"><button className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Filtrer</button><Link href="/admin/journal" className="h-9 rounded-lg border px-3 text-sm leading-9 hover:bg-muted">Réinitialiser</Link></div>
        </form>
      </Panel>
      <Table>
        <thead><tr><Th>Date</Th><Th>Administrateur</Th><Th>Action</Th><Th>Objet</Th><Th>Résultat</Th><Th>Détail</Th></tr></thead>
        <tbody>
          {res.rows.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
              <Td className="max-w-[200px] truncate">{r.actorEmail ?? "—"}</Td>
              <Td className="font-medium">{AUDIT_ACTIONS[r.action] ?? r.action}</Td>
              <Td className="font-mono text-xs">{r.targetType ? `${r.targetType}${r.targetId ? ` · ${r.targetId.slice(0, 12)}` : ""}` : "—"}</Td>
              <Td><Pill tone={statusTone(r.result)}>{RESULT[r.result as keyof typeof RESULT] ?? r.result}</Pill></Td>
              <Td className="max-w-[420px] text-xs text-muted-foreground">{detailText(r.detail)}</Td>
            </tr>
          ))}
          {!res.rows.length && <tr><Td className="py-10 text-center text-muted-foreground">Aucune entrée ne correspond à ces critères.</Td></tr>}
        </tbody>
      </Table>
      <Pagination page={res.page} pages={res.pages} total={res.total} base={base} size={AUDIT_PAGE_SIZE} />
      <Notice className="mt-4"><p>Un déclencheur de base de données refuse toute modification ou suppression d'une entrée du journal, y compris par l'application.</p></Notice>
    </>
  );
}
