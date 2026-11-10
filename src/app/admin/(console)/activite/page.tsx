import Link from "next/link";
import { BarList, Heatmap, Notice, PageHeader, Panel, Stat, Table, Td, Th } from "@/components/admin/primitives";
import { BarsByCategory, TimeChart } from "@/components/admin/charts";
import { fmtDate, fmtNumber, fmtPercent } from "@/components/admin/format";
import { requireAdminPage } from "@/server/admin/session";
import { getCategoryComparison, getHeatmap, getRetention, getTrend, GRANULARITY_LABELS, WEEKDAYS, type Granularity, type HeatMetric } from "@/server/admin/stats/usage";
import { CATEGORIES } from "@/server/analytics/definitions";
import { periodOf, rows, type SP } from "../_lib";

const GRANULARITIES = Object.keys(GRANULARITY_LABELS) as Granularity[];

export default async function UsagePage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage("overview.view");
  const { q, period } = await periodOf(searchParams);
  const metric: HeatMetric = q.hm === "events" ? "events" : "users";
  const category = q.cat && (q.cat === "ALL" || q.cat in CATEGORIES) ? q.cat : "ALL";
  const g = (GRANULARITIES as string[]).includes(q.g ?? "") ? (q.g as Granularity) : "week";
  const [heat, trend, cats, retention] = await Promise.all([getHeatmap(period, metric, category), getTrend(g), getCategoryComparison(period), getRetention()]);
  const link = (patch: Record<string, string>) => {
    const u = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1]));
    for (const [k, v] of Object.entries(patch)) u.set(k, v);
    return `?${u.toString()}`;
  };
  const tab = (active: boolean) => `rounded-lg px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`;
  const topHours = heat.hourTotals.map((v, h) => ({ label: `${h} h – ${h + 1} h`, value: v })).sort((a, b) => b.value - a.value).slice(0, 5).filter((x) => x.value > 0);

  return (
    <>
      <PageHeader title="Activité et utilisation" description="Comment les étudiants utilisent réellement Niala : heures d'activité, tendances, catégories et fidélisation." />

      <Panel title="Heures d'activité" description="Actions significatives par jour de la semaine et heure de la journée (UTC = heure d'Abidjan), sur la période choisie." className="mb-4"
        action={
          <div className="flex flex-wrap gap-2" role="group" aria-label="Options de la carte de chaleur">
            <Link className={tab(metric === "users")} href={link({ hm: "users" })}>Utilisateurs actifs</Link>
            <Link className={tab(metric === "events")} href={link({ hm: "events" })}>Actions</Link>
          </div>
        }>
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Catégorie d'utilisateurs">
          {[["ALL", "Toutes les catégories"], ...Object.entries(CATEGORIES)].map(([k, v]) => <Link key={k} className={tab(category === k)} href={link({ cat: k })}>{v}</Link>)}
        </div>
        {heat.insights.length > 0 ? <div className="mb-3 space-y-1">{heat.insights.map((t) => <Notice key={t}><p>{t}</p></Notice>)}</div> : <Notice className="mb-3"><p>{heat.total ? "L'échantillon est trop réduit (moins de 30 actions ou 3 utilisateurs) pour en tirer une conclusion sur les horaires." : "Aucune activité collectée sur cette période."}</p></Notice>}
        <Heatmap cells={heat.cells} max={heat.max} days={WEEKDAYS} unit={metric === "users" ? "utilisateur(s)" : "action(s)"} />
        {topHours.length > 0 && (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div><h3 className="mb-2 text-sm font-medium">Heures les plus actives</h3><BarList items={topHours} /></div>
            <div><h3 className="mb-2 text-sm font-medium">Jours les plus actifs</h3><BarList items={heat.dayTotals.map((v, d) => ({ label: WEEKDAYS[d], value: v })).sort((a, b) => b.value - a.value).slice(0, 4)} /></div>
          </div>
        )}
      </Panel>

      <Panel title="Tendances" description="Utilisateurs actifs et sessions, comparés à la période précédente de même granularité." className="mb-4"
        action={<div className="flex flex-wrap gap-1.5" role="group" aria-label="Granularité">{GRANULARITIES.map((x) => <Link key={x} className={tab(g === x)} href={link({ g: x })}>{GRANULARITY_LABELS[x]}</Link>)}</div>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <TimeChart kind="area" bucket={g === "quarter" ? "quarter" : g} data={rows(trend, (t) => ({ users: t.activeUsers }))} series={[{ key: "users", name: "Utilisateurs actifs" }]} />
          <TimeChart kind="bar" bucket={g === "quarter" ? "quarter" : g} data={rows(trend, (t) => ({ sessions: t.sessions }))} series={[{ key: "sessions", name: "Sessions", color: "#3b8fd0" }]} />
        </div>
        <div className="mt-4 max-h-64 overflow-auto">
          <Table><thead><tr><Th>Période</Th><Th align="right">Actifs</Th><Th align="right">Évolution</Th><Th align="right">Sessions</Th><Th align="right">Actions</Th></tr></thead>
            <tbody>{[...trend].reverse().map((t) => (
              <tr key={t.bucket.toISOString()}><Td>{g === "quarter" ? `T${Math.floor(t.bucket.getUTCMonth() / 3) + 1} ${t.bucket.getUTCFullYear()}` : fmtDate(t.bucket)}</Td><Td align="right">{fmtNumber(t.activeUsers)}</Td><Td align="right">{t.change == null ? "n/d" : `${t.change > 0 ? "+" : ""}${t.change} %`}</Td><Td align="right">{fmtNumber(t.sessions)}</Td><Td align="right">{fmtNumber(t.events)}</Td></tr>
            ))}</tbody></Table>
        </div>
      </Panel>

      <Panel title="Comparaison des catégories d'utilisateurs" description="Sur la période choisie. Les chiffres rapportés au nombre d'actifs permettent de comparer des catégories de tailles différentes." className="mb-4">
        <div className="mb-4 grid gap-4 lg:grid-cols-2">
          <BarsByCategory data={cats.map((c) => ({ label: c.label.replace("Étudiants ", "").replace("Autres utilisateurs et testeurs", "Autres / testeurs"), actifs: c.active, comptes: c.accounts }))} series={[{ key: "comptes", name: "Comptes" }, { key: "actifs", name: "Actifs" }]} height={220} />
          <BarsByCategory data={cats.map((c) => ({ label: c.label.replace("Étudiants ", "").replace("Autres utilisateurs et testeurs", "Autres / testeurs"), sessions: c.sessionsPerUser ?? 0, exercices: c.exercisesPerUser ?? 0 }))} series={[{ key: "sessions", name: "Sessions par actif" }, { key: "exercices", name: "Exercices par actif" }]} height={220} />
        </div>
        <Table><thead><tr><Th>Catégorie</Th><Th align="right">Comptes</Th><Th align="right">Actifs</Th><Th align="right">Sessions</Th><Th align="right">Sessions / actif</Th><Th align="right">Durée moy. (min)</Th><Th align="right">Actions / actif</Th><Th align="right">Exercices terminés</Th><Th align="right">Messages IA</Th></tr></thead>
          <tbody>{cats.map((c) => <tr key={c.key}><Td className="font-medium">{c.label}</Td><Td align="right">{fmtNumber(c.accounts)}</Td><Td align="right">{fmtNumber(c.active)}</Td><Td align="right">{fmtNumber(c.sessions)}</Td><Td align="right">{fmtNumber(c.sessionsPerUser)}</Td><Td align="right">{fmtNumber(c.avgSessionMin)}</Td><Td align="right">{fmtNumber(c.eventsPerUser)}</Td><Td align="right">{fmtNumber(c.exercisesDone)}</Td><Td align="right">{fmtNumber(c.assistantMessages)}</Td></tr>)}</tbody></Table>
      </Panel>

      <Panel title="Fidélisation" description="Part des inscrits qui reviennent. J1, J7 et J30 = au moins une action significative le 1ᵉʳ, 7ᵉ ou 30ᵉ jour après l'inscription (jour calendaire, UTC). Seules les cohortes assez anciennes sont comptées.">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Rétention J1" value={fmtPercent(retention.overall.d1)} hint={`${retention.overall.eligible.d1} inscrits éligibles`} />
          <Stat label="Rétention J7" value={fmtPercent(retention.overall.d7)} hint={`${retention.overall.eligible.d7} inscrits éligibles`} />
          <Stat label="Rétention J30" value={fmtPercent(retention.overall.d30)} hint={`${retention.overall.eligible.d30} inscrits éligibles`} />
          <Stat label="Revenus après l'inscription" value={fmtPercent(retention.returned.rate)} hint="Inscrits ayant eu une activité un jour postérieur à celui de leur inscription." />
          <Stat label="Décrochage" value={`${retention.fading.dropped} + ${retention.fading.declining}`} hint="Actifs il y a 30-60 jours (≥ 2 jours) puis plus aucune activité (1ᵉʳ nombre) ou activité divisée par plus de 2 (2ᵉ nombre)." tone={retention.fading.dropped ? "warn" : undefined} />
        </div>
        {!retention.liveSince && <Notice tone="warn" className="mb-3"><p>Aucune activité n'a encore été collectée : la rétention s'affichera dès les premiers retours mesurés.</p></Notice>}
        {retention.liveSince && <Notice className="mb-3"><p>La rétention n'est mesurable que depuis le début de la collecte ({fmtDate(retention.liveSince)}) ou depuis la reconstitution de l'historique. Une cohorte inscrite avant cette date peut paraître sous-estimée.</p></Notice>}
        <Table><thead><tr><Th>Cohorte (semaine d'inscription)</Th><Th align="right">Inscrits</Th><Th align="right">J1</Th><Th align="right">J7</Th><Th align="right">J30</Th></tr></thead>
          <tbody>
            {retention.cohorts.map((c) => <tr key={c.cohort.toISOString()}><Td>{fmtDate(c.cohort)}</Td><Td align="right">{c.size}</Td><Td align="right">{c.d1 == null ? "n/d" : `${c.d1} %`}</Td><Td align="right">{c.d7 == null ? "n/d" : `${c.d7} %`}</Td><Td align="right">{c.d30 == null ? "n/d" : `${c.d30} %`}</Td></tr>)}
            {!retention.cohorts.length && <tr><Td className="py-8 text-center text-muted-foreground">Aucune inscription sur les 12 dernières semaines.</Td></tr>}
          </tbody></Table>
      </Panel>
    </>
  );
}
