import { BarList, Delta, Notice, PageHeader, Panel, Pill, Stat, Table, Td, Th } from "@/components/admin/primitives";
import { BarsByCategory } from "@/components/admin/charts";
import { fmtMs, fmtNumber, fmtPercent } from "@/components/admin/format";
import { requireAdminPage } from "@/server/admin/session";
import { getFeatureReport } from "@/server/admin/stats/features";
import { periodOf, type SP } from "../_lib";

export default async function FeaturesPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage("overview.view");
  const { period } = await periodOf(searchParams);
  const r = await getFeatureReport(period);
  const ranked = [...r.features].sort((a, b) => (b.adoption ?? 0) - (a.adoption ?? 0) || (b.uses.value ?? 0) - (a.uses.value ?? 0));

  return (
    <>
      <PageHeader title="Fonctionnalités" description={`Quelles fonctionnalités apportent de la valeur — ${period.label.toLowerCase()}. ${fmtNumber(r.activeUsers)} utilisateur(s) actif(s) sur la période.`} />

      <Notice className="mb-4">
        <p>Adoption = part des utilisateurs actifs de la période ayant utilisé la fonctionnalité. Abandon = exercices démarrés puis laissés sans activité plus de 7 jours, rapportés aux exercices démarrés et résolus. Erreurs = appels IA en échec quand la fonctionnalité repose sur l'IA, sinon événements en échec.</p>
        <p>Niala ne propose ni atelier Merise, ni éditeur mathématique : ils ne figurent donc pas dans cette liste.</p>
      </Notice>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Classement par adoption" description="Les plus populaires en premier." className="lg:col-span-1">
          <BarList items={ranked.map((f) => ({ label: f.label, value: f.adoption ?? 0, sub: `${fmtNumber(f.uses.value)} util.` }))} suffix=" %" max={100} />
        </Panel>
        <Panel title="À améliorer" description="Fonctionnalités qui cumulent un signal d'alerte (échecs, abandons, baisse, adoption faible)." className="lg:col-span-2">
          {r.needsWork.length ? (
            <ul className="divide-y text-sm">
              {r.needsWork.map(({ feature, reasons }) => (
                <li key={feature.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5"><span className="font-medium">{feature.label}</span><span className="flex flex-wrap gap-1.5">{reasons.map((x) => <Pill key={x} tone="warn">{x}</Pill>)}</span></li>
              ))}
            </ul>
          ) : <p className="py-6 text-center text-sm text-muted-foreground">Aucun signal d'alerte sur la période (seuils : ≥ 3 échecs et ≥ 10 %, ≥ 5 résolutions et ≥ 50 % d'abandon, baisse ≥ 30 %).</p>}
        </Panel>
      </div>

      <Panel title="Détail par fonctionnalité" className="mb-4">
        <Table>
          <thead><tr><Th>Fonctionnalité</Th><Th align="right">Utilisateurs uniques</Th><Th align="right">Utilisations</Th><Th align="right">Évolution</Th><Th align="right">Fréquence</Th><Th align="right">Adoption</Th><Th align="right">Abandon</Th><Th align="right">Erreurs</Th><Th align="right">Temps moyen</Th></tr></thead>
          <tbody>
            {r.features.map((f) => (
              <tr key={f.key} className="hover:bg-muted/40">
                <Td className="font-medium">{f.label}</Td>
                <Td align="right">{fmtNumber(f.uniqueUsers.value)}</Td>
                <Td align="right">{fmtNumber(f.uses.value)}</Td>
                <Td align="right"><Delta change={f.uses.change} /></Td>
                <Td align="right" >{f.frequency == null ? "—" : `${fmtNumber(f.frequency)} / util.`}</Td>
                <Td align="right">{fmtPercent(f.adoption)}</Td>
                <Td align="right">{f.abandonment ? (f.abandonment.rate == null ? "n/d" : `${fmtPercent(f.abandonment.rate)} (${f.abandonment.abandoned}/${f.abandonment.abandoned + f.abandonment.completed})`) : <span className="text-muted-foreground" title="Sans objet pour cette fonctionnalité">—</span>}</Td>
                <Td align="right">{f.errors.count}{f.errors.rate != null && <span className="text-xs text-muted-foreground"> ({fmtPercent(f.errors.rate)})</span>}<span className="sr-only"> source {f.errors.source}</span></Td>
                <Td align="right">{fmtMs(f.avgProcessingMs)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Suggestions de révision" description="Recommandations générées par Niala dans la période (historique complet) : affichées, puis suivies ou écartées par l'étudiant." className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Affichées" value={fmtNumber(r.recommendations.shown)} />
          <Stat label="Suivies" value={fmtNumber(r.recommendations.followed)} tone="good" hint="Activité démarrée ou terminée." />
          <Stat label="Écartées" value={fmtNumber(r.recommendations.dismissed)} />
          <Stat label="En attente" value={fmtNumber(r.recommendations.pending)} />
          <Stat label="Taux de suivi" value={fmtPercent(r.recommendations.followRate)} />
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Utilisations par fonctionnalité"><BarsByCategory horizontal height={Math.max(220, r.features.length * 34)} data={r.features.map((f) => ({ label: f.label, utilisations: f.uses.value ?? 0, utilisateurs: f.uniqueUsers.value ?? 0 }))} series={[{ key: "utilisations", name: "Utilisations" }, { key: "utilisateurs", name: "Utilisateurs uniques" }]} /></Panel>
        <Panel title="Ouvertures de modules" description="Pages ouvertes depuis la navigation (collecte en direct).">
          {r.modules.length ? <BarList items={r.modules.map((m) => ({ label: m.label, value: m.opens, sub: `${m.users} util.` }))} /> : <p className="py-6 text-center text-sm text-muted-foreground">Aucune ouverture de module collectée sur la période.</p>}
        </Panel>
      </div>
    </>
  );
}
