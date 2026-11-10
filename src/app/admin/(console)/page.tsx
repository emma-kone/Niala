import Link from "next/link";
import { Delta, EmptyState, KpiCard, Notice, PageHeader, Panel, Pill } from "@/components/admin/primitives";
import { Donut, TimeChart } from "@/components/admin/charts";
import { fmtDateTime, fmtNumber } from "@/components/admin/format";
import { can } from "@/server/admin/rbac";
import { requireAdminPage } from "@/server/admin/session";
import { rankFeatures } from "@/server/admin/stats/features";
import { getOverview } from "@/server/admin/stats/overview";
import { listAlerts } from "@/server/admin/stats/tech";
import { periodOf, rows, type SP } from "./_lib";

export default async function OverviewPage({ searchParams }: { searchParams: SP }) {
  const admin = await requireAdminPage("overview.view");
  const { period } = await periodOf(searchParams);
  const [o, ranking, alerts] = await Promise.all([getOverview(period), rankFeatures(period), can(admin.role, "tech.view") ? listAlerts(5) : Promise.resolve([])]);
  const openAlerts = alerts.filter((a) => a.status === "OPEN");
  const bucket = period.bucket;

  return (
    <>
      <PageHeader title="Vue d'ensemble" description={`Santé et activité de Niala — ${period.label.toLowerCase()}, comparées à la période précédente de même durée.`} />

      <div className="mb-6 space-y-2">
        {o.insights.map((t) => <Notice key={t} tone="warn"><p>{t}</p></Notice>)}
        {openAlerts.map((a) => (
          <Notice key={a.id} tone="warn"><p><strong>{a.title}</strong> — {a.detail} <Link href="/admin/performance" className="underline">Voir la supervision</Link></p></Notice>
        ))}
      </div>

      <section aria-labelledby="k-users" className="mb-8">
        <h2 id="k-users" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Utilisateurs</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">{o.kpis.users.map((k) => <KpiCard key={k.key} kpi={k} />)}</div>
      </section>

      <section aria-labelledby="k-usage" className="mb-8">
        <h2 id="k-usage" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Utilisation</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{o.kpis.usage.map((k) => <KpiCard key={k.key} kpi={k} />)}</div>
      </section>

      <section aria-labelledby="k-eng" className="mb-8">
        <h2 id="k-eng" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Engagement</h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {o.kpis.engagement.map((k) => <KpiCard key={k.key} kpi={k} />)}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Panel title="Fonctionnalités les plus utilisées" description="Par nombre d'utilisations sur la période.">
            {ranking.most.length ? (
              <ol className="space-y-2 text-sm">
                {ranking.most.map((f, i) => (
                  <li key={f.key} className="flex items-center justify-between gap-3"><span>{i + 1}. {f.label}</span><span className="flex items-center gap-2 tabular-nums">{fmtNumber(f.uses.value)}<Delta change={f.uses.change} /></span></li>
                ))}
              </ol>
            ) : <EmptyState title="Aucune utilisation mesurée sur la période." />}
          </Panel>
          <Panel title="Fonctionnalités les moins utilisées" description="Les moins sollicitées, y compris celles qui ne sont pas encore utilisées.">
            <ol className="space-y-2 text-sm">
              {ranking.least.map((f) => (
                <li key={f.key} className="flex items-center justify-between gap-3"><span>{f.label}</span><span className="tabular-nums text-muted-foreground">{fmtNumber(f.uses.value)} utilisation{(f.uses.value ?? 0) > 1 ? "s" : ""}</span></li>
              ))}
            </ol>
            <Link href="/admin/fonctionnalites" className="mt-3 inline-block text-xs underline">Analyse détaillée des fonctionnalités</Link>
          </Panel>
        </div>
      </section>

      <section aria-labelledby="graphs" className="mb-8">
        <h2 id="graphs" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Évolutions</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Inscriptions"><TimeChart kind="bar" bucket={bucket} data={rows(o.series.registrations, (p) => ({ n: p.value }))} series={[{ key: "n", name: "Inscriptions" }]} /></Panel>
          <Panel title="Utilisateurs actifs" description="Au moins une action significative dans la période."><TimeChart kind="area" bucket={bucket} data={rows(o.series.activeUsers, (p) => ({ n: p.value }))} series={[{ key: "n", name: "Utilisateurs actifs" }]} /></Panel>
          <Panel title="Sessions" description="Session = activité sans pause de plus de 30 minutes."><TimeChart kind="line" bucket={bucket} data={rows(o.series.sessions, (p) => ({ n: p.value }))} series={[{ key: "n", name: "Sessions", color: "#3b8fd0" }]} /></Panel>
          <Panel title="Exercices réalisés"><TimeChart kind="bar" bucket={bucket} data={rows(o.series.exercises, (p) => ({ n: p.value }))} series={[{ key: "n", name: "Exercices terminés", color: "#3fa384" }]} /></Panel>
          <Panel title="Engagement" description="Actions significatives par utilisateur actif."><TimeChart kind="line" bucket={bucket} data={rows(o.series.engagement, (p) => ({ n: p.value }))} series={[{ key: "n", name: "Actions par actif", color: "#e0a13a" }]} suffix="" /></Panel>
          <Panel title="Répartition des utilisateurs par catégorie" description="Tous les comptes étudiants, quelle que soit la période."><Donut data={o.categories.map((c) => ({ label: c.label, value: c.value }))} /></Panel>
        </div>
      </section>

      {alerts.length > 0 && (
        <Panel title="Dernières alertes" description="Détectées automatiquement par la supervision.">
          <ul className="divide-y text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="flex items-center gap-2"><Pill tone={a.status === "OPEN" ? (a.severity === "CRITICAL" ? "bad" : "warn") : "neutral"}>{a.status === "OPEN" ? (a.severity === "CRITICAL" ? "Critique" : "Attention") : "Résolue"}</Pill>{a.title}</span><span className="text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span></li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
