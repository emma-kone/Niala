import Link from "next/link";
import { BarList, Delta, EmptyState, Notice, PageHeader, Pagination, Panel, Pill, priorityTone, SortHeader, Stat, statusTone, Table, Td, Th } from "@/components/admin/primitives";
import { TimeChart } from "@/components/admin/charts";
import { fmtDate, fmtHours, fmtNumber, fmtPercent } from "@/components/admin/format";
import { can } from "@/server/admin/rbac";
import { requireAdminPage } from "@/server/admin/session";
import { assignableAdmins, getRequestAnalytics, listRequests, listRoadmap, REQUEST_PAGE_SIZE, requestCounts } from "@/server/admin/support";
import { MODULES, PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES, ROADMAP_STATUSES } from "@/server/analytics/definitions";
import { RoadmapStatusSelect } from "@/features/admin/request-panel";
import { RequestsTable } from "@/features/admin/requests-table";
import { flat, keep, periodOf, rows, type SP } from "../_lib";

export default async function RequestsPage({ searchParams }: { searchParams: SP }) {
  const admin = await requireAdminPage("support.view");
  const { q, period } = await periodOf(searchParams);
  const view = q.view === "analyse" ? "analyse" : q.view === "feuille" ? "feuille" : "liste";
  const tab = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`;
  const counts = await requestCounts();
  const manage = can(admin.role, "support.manage");

  const header = (
    <>
      <PageHeader title="Suggestions et demandes" description="Retours, signalements et demandes d'assistance envoyés par les étudiants depuis Niala, et par les visiteurs sans compte depuis la page de connexion." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total des demandes" value={fmtNumber(counts.total)} />
        <Stat label="Nouvelles" value={fmtNumber(counts.received)} tone={counts.received ? "warn" : undefined} />
        <Stat label="En attente d'examen" value={fmtNumber(counts.pending)} />
        <Stat label="En cours" value={fmtNumber(counts.inProgress)} />
        <Stat label="Résolues" value={fmtNumber(counts.resolved)} tone="good" />
        <Stat label="Urgentes (ouvertes)" value={fmtNumber(counts.urgent)} tone={counts.urgent ? "warn" : undefined} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Vues">
        <Link className={tab(view === "liste")} href="?view=liste">Demandes</Link>
        <Link className={tab(view === "analyse")} href={`?view=analyse&${period.query}`}>Analyse des suggestions</Link>
        <Link className={tab(view === "feuille")} href="?view=feuille">Feuille de route</Link>
      </div>
    </>
  );

  if (view === "analyse") {
    const a = await getRequestAnalytics(period);
    return (
      <>
        {header}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Demandes sur la période" value={<span className="flex items-center gap-2">{fmtNumber(a.total)}<Delta change={a.change} /></span>} />
          <Stat label="Délai moyen de première réponse" value={fmtHours(a.avgFirstReplyHours)} hint="Entre l'envoi et la première réponse de l'équipe." />
          <Stat label="Temps moyen de traitement" value={fmtHours(a.avgResolutionHours)} hint="Entre l'envoi et la clôture (résolue ou refusée)." />
          <Stat label="Taux de clôture" value={fmtPercent(a.resolutionRate)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Évolution du nombre de demandes"><TimeChart kind="bar" bucket={period.bucket} data={rows(a.series, (s) => ({ n: s.value }))} series={[{ key: "n", name: "Demandes" }]} /></Panel>
          <Panel title="Catégories les plus fréquentes"><BarList items={a.byType.map((t) => ({ label: t.label, value: t.value }))} /></Panel>
          <Panel title="Modules générant le plus de demandes" description="Dont problèmes = signalements techniques, difficultés d'exercice et problèmes d'IA."><BarList items={a.byModule.map((m) => ({ label: m.label, value: m.value, sub: m.problems ? `dont ${m.problems} problème(s)` : undefined }))} /></Panel>
          <Panel title="Besoins récurrents" description="Demandes regroupées dans la feuille de route : plus un besoin revient, plus il est prioritaire.">
            {a.recurring.length ? <BarList items={a.recurring.map((r) => ({ label: r.title, value: r.requests, sub: `${r.users} étud. · ${ROADMAP_STATUSES[r.status as keyof typeof ROADMAP_STATUSES]}` }))} /> : <EmptyState title="Aucun regroupement pour l'instant.">Depuis la fiche d'une demande, regroupez les demandes similaires dans un élément de feuille de route.</EmptyState>}
          </Panel>
        </div>
      </>
    );
  }

  if (view === "feuille") {
    const items = await listRoadmap();
    return (
      <>
        {header}
        <Panel title="Feuille de route produit" description="Besoins issus des retours des étudiants. Quand un élément passe à « Déployée », les étudiants concernés en sont informés dans Niala.">
          {items.length ? (
            <Table><thead><tr><Th>Élément</Th><Th align="right">Demandes</Th><Th>Statut</Th><Th>Mis à jour</Th></tr></thead>
              <tbody>{items.map((i) => <tr key={i.id}><Td className="font-medium">{i.title}{i.description && <span className="block text-xs font-normal text-muted-foreground">{i.description}</span>}</Td><Td align="right">{i.requests}</Td><Td>{manage ? <RoadmapStatusSelect id={i.id} status={i.status} /> : <Pill tone={statusTone(i.status)}>{ROADMAP_STATUSES[i.status as keyof typeof ROADMAP_STATUSES]}</Pill>}</Td><Td className="whitespace-nowrap">{fmtDate(i.updatedAt)}</Td></tr>)}</tbody></Table>
          ) : <EmptyState title="La feuille de route est vide.">Ouvrez une suggestion puis choisissez « Transformer en élément de feuille de route ».</EmptyState>}
        </Panel>
      </>
    );
  }

  const f = await flat(searchParams);
  const [res, admins] = await Promise.all([listRequests(f), assignableAdmins()]);
  const base = keep(f);
  const sh = (label: string, field: string) => <SortHeader label={label} field={field} current={res.query.sort} dir={res.query.dir} base={base} />;
  const sel = "h-9 w-full rounded-lg border bg-background px-2 text-sm";
  const nameOf = (id: string | null) => (id ? (admins.find((a) => a.id === id)?.name ?? admins.find((a) => a.id === id)?.email ?? "—") : "Non assignée");

  return (
    <>
      {header}
      <Panel className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filtrer les demandes">
          <input type="hidden" name="view" value="liste" />
          <label className="text-xs text-muted-foreground lg:col-span-2">Recherche (référence, objet, utilisateur)<input name="q" defaultValue={f.q} className={`${sel} mt-1`} /></label>
          <label className="text-xs text-muted-foreground">Type<select name="type" defaultValue={f.type ?? ""} className={`${sel} mt-1`}><option value="">Tous</option>{Object.entries(REQUEST_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Statut<select name="status" defaultValue={f.status ?? ""} className={`${sel} mt-1`}><option value="">Tous</option>{Object.entries(REQUEST_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Priorité<select name="priority" defaultValue={f.priority ?? ""} className={`${sel} mt-1`}><option value="">Toutes</option>{Object.entries(PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Module<select name="module" defaultValue={f.module ?? ""} className={`${sel} mt-1`}><option value="">Tous</option>{Object.entries(MODULES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="other">Autre</option></select></label>
          <label className="text-xs text-muted-foreground">Responsable<select name="assignee" defaultValue={f.assignee ?? ""} className={`${sel} mt-1`}><option value="">Tous</option><option value="none">Non assignée</option>{admins.map((a) => <option key={a.id} value={a.id}>{a.name ?? a.email}</option>)}</select></label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="open" value="1" defaultChecked={f.open === "1"} /> Ouvertes seulement</label>
          <div className="flex items-end gap-2"><button className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Filtrer</button><Link href="?view=liste" className="h-9 rounded-lg border px-3 text-sm leading-9 hover:bg-muted">Réinitialiser</Link></div>
        </form>
      </Panel>
      <RequestsTable
        manage={manage}
        headers={{ sortType: sh("Type", "type"), sortDate: sh("Soumise le", "createdAt"), sortPriority: sh("Priorité", "priority"), sortStatus: sh("Statut", "status") }}
        rows={res.rows.map((r) => ({ id: r.id, reference: r.reference, type: r.type, subject: r.subject, description: r.description, module: r.module, priority: r.priority, status: r.status, createdAt: r.createdAt.toISOString(), who: r.userName ?? (r.userEmail || "—"), guest: r.guest, assignee: nameOf(r.assigneeId) }))}
      />
      <Pagination page={res.page} pages={res.pages} total={res.total} base={base} size={REQUEST_PAGE_SIZE} />
      {!manage && <Notice className="mt-4"><p>Votre rôle permet de consulter les demandes mais pas d'y répondre.</p></Notice>}
    </>
  );
}
