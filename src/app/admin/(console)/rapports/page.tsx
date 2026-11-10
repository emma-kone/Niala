import { FileSpreadsheet, FileText, FileType2 } from "lucide-react";
import Link from "next/link";
import { EmptyState, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/admin/primitives";
import { TimeChart } from "@/components/admin/charts";
import { can } from "@/server/admin/rbac";
import { buildReport, REPORTS } from "@/server/admin/reports";
import { requireAdminPage } from "@/server/admin/session";
import { periodOf, type SP } from "../_lib";

const DESCRIPTIONS: Record<string, string> = {
  users: "Inscriptions, utilisateurs actifs, catégories et rétention par cohorte.",
  activity: "Sessions, durée, engagement et comparaison des catégories.",
  features: "Utilisation, adoption, abandon et erreurs de chaque fonctionnalité.",
  hours: "Carte de chaleur jour × heure et heures de pointe.",
  pedagogy: "Exercices, réussite par matière, environnements pratiques, difficultés.",
  requests: "Demandes reçues, délais de traitement, besoins récurrents.",
  tech: "Disponibilité, temps de réponse, erreurs classées par origine.",
  ai: "Appels IA, échecs, temps de réponse, répartition par fonctionnalité et modèle.",
};

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  const admin = await requireAdminPage("reports.view");
  const { q, period } = await periodOf(searchParams);
  const canExport = can(admin.role, "reports.export");
  const preview = REPORTS.find((r) => r.key === q.preview);
  // Les rapports technique et IA ne sont accessibles qu'avec la permission de supervision.
  const allowed = REPORTS.filter((r) => (r.key === "tech" || r.key === "ai" ? can(admin.role, "tech.view") : r.key === "requests" ? can(admin.role, "support.view") : true));
  const report = preview && allowed.some((r) => r.key === preview.key) ? await buildReport(preview.key, period) : null;
  const href = (key: string, format: string) => `/api/admin/reports/${key}?format=${format}&${period.query}`;

  return (
    <>
      <PageHeader title="Rapports et statistiques" description={`Les rapports reprennent la période sélectionnée en haut de page : ${period.label.toLowerCase()}.`} />
      <Notice className="mb-4"><p>Les exports contiennent des données agrégées. CSV et Excel contiennent les tableaux complets ; le PDF ajoute des graphiques et limite les très grands tableaux. Chaque export est enregistré dans le journal d'activité.</p></Notice>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {allowed.map((r) => (
          <Panel key={r.key} title={r.label} description={DESCRIPTIONS[r.key]}>
            <div className="flex flex-wrap gap-2">
              <Link href={`?preview=${r.key}&${period.query}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Aperçu</Link>
              {canExport ? (
                <>
                  <a href={href(r.key, "csv")} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted" download><FileText className="h-3.5 w-3.5" aria-hidden />CSV</a>
                  <a href={href(r.key, "xlsx")} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted" download><FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />Excel</a>
                  <a href={href(r.key, "pdf")} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted" download><FileType2 className="h-3.5 w-3.5" aria-hidden />PDF</a>
                </>
              ) : <span className="text-xs text-muted-foreground">Export non autorisé pour votre rôle.</span>}
            </div>
          </Panel>
        ))}
      </div>

      {report && (
        <section className="mt-8" aria-labelledby="prev">
          <h2 id="prev" className="mb-3 text-lg font-semibold">Aperçu — {report.title}</h2>
          <div className="mb-3 space-y-1">{report.notes.map((n) => <Notice key={n}><p>{n}</p></Notice>)}</div>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            {report.charts.map((c) => (
              <Panel key={c.title} title={c.title}>
                <TimeChart kind={c.kind === "bar" ? "bar" : "line"} bucket="day" data={c.labels.map((l, i) => ({ bucket: String(i), label: l, n: c.values[i] ?? 0 }))} series={[{ key: "n", name: c.title }]} height={200} />
              </Panel>
            ))}
          </div>
          {report.tables.map((t) => (
            <Panel key={t.title} title={t.title} className="mb-4">
              {t.rows.length ? (
                <div className="max-h-96 overflow-auto"><Table><thead><tr>{t.columns.slice(0, 12).map((c) => <Th key={c}>{c}</Th>)}</tr></thead><tbody>{t.rows.slice(0, 60).map((r, i) => <tr key={i}>{r.slice(0, 12).map((c, k) => <Td key={k} align={typeof c === "number" ? "right" : undefined}>{c ?? "—"}</Td>)}</tr>)}</tbody></Table></div>
              ) : <EmptyState title="Aucune donnée sur cette période." />}
            </Panel>
          ))}
        </section>
      )}
    </>
  );
}
