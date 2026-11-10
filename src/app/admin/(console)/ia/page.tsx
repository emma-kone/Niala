import { BarList, Delta, EmptyState, Notice, PageHeader, Panel, Stat, Table, Td, Th } from "@/components/admin/primitives";
import { Donut, TimeChart } from "@/components/admin/charts";
import { fmtMs, fmtNumber, fmtPercent } from "@/components/admin/format";
import { requireAdminPage } from "@/server/admin/session";
import { getAiReport } from "@/server/admin/stats/ai";
import { evaluateAlerts, listAlerts } from "@/server/admin/stats/tech";
import { periodOf, rows, type SP } from "../_lib";

export default async function AiPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage("tech.view");
  const { period } = await periodOf(searchParams);
  await evaluateAlerts();
  const [a, alerts] = await Promise.all([getAiReport(period), listAlerts(30)]);
  const aiAlerts = alerts.filter((x) => x.status === "OPEN" && x.key.startsWith("ai."));

  return (
    <>
      <PageHeader title="Intelligence artificielle" description={`Utilisation de l'IA par Niala — ${period.label.toLowerCase()}. Aucune clé, aucun prompt et aucune réponse n'est exposé ici.`} />
      {aiAlerts.map((x) => <Notice key={x.id} tone="warn" className="mb-3"><p><strong>{x.title}</strong> · {x.detail}</p></Notice>)}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Appels IA" value={<span className="flex items-center gap-2">{fmtNumber(a.calls.value)}<Delta change={a.calls.change} /></span>} />
        <Stat label="Réussis" value={fmtNumber(a.ok)} tone="good" />
        <Stat label="Échoués" value={`${fmtNumber(a.failed)}${a.failureRate != null ? ` (${fmtPercent(a.failureRate)})` : ""}`} tone={a.failed ? "warn" : undefined} />
        <Stat label="Temps moyen" value={fmtMs(a.avgMs)} hint="Appels réussis uniquement." />
        <Stat label="95ᵉ percentile" value={fmtMs(a.p95Ms)} />
        <Stat label="Volume traité" value={`${fmtNumber(Math.round((a.chars.prompt + a.chars.response) / 1000))} k car.`} hint={`${fmtNumber(a.chars.prompt)} caractères envoyés · ${fmtNumber(a.chars.response)} reçus`} />
        <Stat label="Générations d'exercices" value={fmtNumber(a.generations)} />
        <Stat label="Analyses de documents" value={fmtNumber(a.documentAnalyses)} />
        <Stat label="Corrections et assistances" value={fmtNumber(a.assistances)} hint="Correction, tuteur, assistant, labos." />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Appels IA dans le temps"><TimeChart kind="area" bucket={period.bucket} data={rows(a.series, (s) => ({ calls: s.calls, failed: s.failed }))} series={[{ key: "calls", name: "Appels" }, { key: "failed", name: "Échecs", color: "#d9658b" }]} /></Panel>
        <Panel title="Répartition par modèle"><Donut data={a.byModel.map((m) => ({ label: m.model, value: m.calls }))} height={190} /></Panel>
        <Panel title="Fonctionnalités les plus consommatrices" description="Part des appels sur la période.">
          <BarList items={a.byFeature.map((f) => ({ label: f.label, value: f.calls, sub: `${fmtPercent(f.share)}${f.failed ? ` · ${f.failed} échec(s)` : ""}` }))} />
        </Panel>
        <Panel title="Détail par fonctionnalité">
          {a.byFeature.length ? (
            <Table><thead><tr><Th>Fonctionnalité</Th><Th align="right">Appels</Th><Th align="right">Échecs</Th><Th align="right">Temps moy.</Th><Th align="right">Volume (car.)</Th></tr></thead>
              <tbody>{a.byFeature.map((f) => <tr key={f.key}><Td>{f.label}</Td><Td align="right">{fmtNumber(f.calls)}</Td><Td align="right">{f.failed}</Td><Td align="right">{fmtMs(f.avgMs)}</Td><Td align="right">{fmtNumber(f.chars)}</Td></tr>)}</tbody></Table>
          ) : <EmptyState title="Aucun appel IA sur la période." />}
        </Panel>
        <Panel title="Modèles" className="lg:col-span-1">
          {a.byModel.length ? (
            <Table><thead><tr><Th>Modèle</Th><Th align="right">Appels</Th><Th align="right">Échecs</Th><Th align="right">Temps moyen</Th></tr></thead><tbody>{a.byModel.map((m) => <tr key={m.model}><Td>{m.model}</Td><Td align="right">{m.calls}</Td><Td align="right">{m.failed}</Td><Td align="right">{fmtMs(m.avgMs)}</Td></tr>)}</tbody></Table>
          ) : <EmptyState title="Aucun modèle utilisé sur la période." />}
        </Panel>
        <Panel title="Erreurs les plus fréquentes" description="Messages tronqués ; ils ne contiennent ni clé ni contenu d'étudiant.">
          {a.topErrors.length ? <ul className="divide-y text-sm">{a.topErrors.map((e, i) => <li key={i} className="flex justify-between gap-3 py-2"><span className="min-w-0"><span className="block truncate">{e.message}</span><span className="text-xs text-muted-foreground">{e.feature}</span></span><span className="tabular-nums">{e.count}</span></li>)}</ul> : <EmptyState title="Aucun échec sur la période." />}
        </Panel>
      </div>

      <Notice><p><strong>Ce qui n'est pas mesuré</strong></p>{a.unavailable.map((u) => <p key={u}>{u}</p>)}</Notice>
    </>
  );
}
