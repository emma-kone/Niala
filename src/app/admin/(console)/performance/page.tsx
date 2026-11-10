import Link from "next/link";
import { BarList, EmptyState, Notice, PageHeader, Panel, Pill, Stat, statusTone, Table, Td, Th } from "@/components/admin/primitives";
import { Donut, TimeChart } from "@/components/admin/charts";
import { fmtDateTime, fmtMs, fmtNumber, fmtPercent } from "@/components/admin/format";
import { ResolveAlertButton } from "@/features/admin/small-actions";
import { requireAdminPage } from "@/server/admin/session";
import { evaluateAlerts, getTechReport, listAlerts } from "@/server/admin/stats/tech";
import { MODULES } from "@/server/analytics/definitions";
import { periodOf, rows, type SP } from "../_lib";

const KIND: Record<string, { label: string; tone: "info" | "bad" | "warn" }> = { USER: { label: "Utilisateur", tone: "info" }, APP: { label: "Application", tone: "bad" }, EXTERNAL: { label: "Service externe", tone: "warn" } };

export default async function PerformancePage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage("tech.view");
  const { q, period } = await periodOf(searchParams);
  await evaluateAlerts();
  const moduleFilter = q.module && q.module.length < 30 ? q.module : null;
  const [t, alerts] = await Promise.all([getTechReport(period, moduleFilter), listAlerts(30)]);
  const open = alerts.filter((a) => a.status === "OPEN");
  const labelOfModule = (m: string) => (MODULES as Record<string, string>)[m] ?? m;

  return (
    <>
      <PageHeader title="Performance technique" description={`Santé technique de la plateforme — ${period.label.toLowerCase()}. Les erreurs sont classées : utilisateur, application ou service externe.`}
        actions={
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="p" value={period.key} />
            {period.key === "custom" && <><input type="hidden" name="from" value={q.from} /><input type="hidden" name="to" value={q.to} /></>}
            <label className="sr-only" htmlFor="mod">Module</label>
            <select id="mod" name="module" defaultValue={moduleFilter ?? ""} className="h-9 rounded-lg border bg-background px-2 text-sm"><option value="">Tous les modules</option>{t.modules.map((m) => <option key={m} value={m}>{labelOfModule(m)}</option>)}</select>
            <button className="h-9 rounded-lg border px-3 text-sm hover:bg-muted">Filtrer</button>
          </form>
        } />

      {open.length > 0 && (
        <div className="mb-4 space-y-2" role="region" aria-label="Alertes ouvertes">
          {open.map((a) => (
            <Notice key={a.id} tone="warn"><div className="flex flex-wrap items-center justify-between gap-3"><p><strong>{a.severity === "CRITICAL" ? "Critique — " : ""}{a.title}</strong> · {a.detail}</p><ResolveAlertButton id={a.id} /></div></Notice>
          ))}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Requêtes mesurées" value={fmtNumber(t.requests)} />
        <Stat label="Disponibilité (trafic réel)" value={fmtPercent(t.availability)} tone={t.availability != null && t.availability < 99 ? "warn" : undefined} hint="Part des requêtes sans erreur serveur." />
        <Stat label="Taux d'erreurs" value={fmtPercent(t.errorRate)} />
        <Stat label="Erreurs serveur (5xx)" value={fmtNumber(t.serverErrors)} tone={t.serverErrors ? "warn" : undefined} />
        <Stat label="Réponse moyenne / médiane" value={`${fmtMs(t.avgMs)} / ${fmtMs(t.p50Ms)}`} />
        <Stat label="95ᵉ percentile" value={fmtMs(t.p95Ms)} hint="95 % des requêtes répondent plus vite que cette valeur." />
      </div>
      {!t.requests && <Notice className="mb-4"><p>Aucune requête n'a été mesurée sur cette période : la collecte démarre avec le back-office et ne couvre pas l'historique antérieur.</p></Notice>}

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Trafic et erreurs serveur"><TimeChart kind="line" bucket={period.bucket} data={rows(t.series, (s) => ({ requests: s.requests, errors: s.errors }))} series={[{ key: "requests", name: "Requêtes" }, { key: "errors", name: "Erreurs serveur", color: "#d9658b" }]} /></Panel>
        <Panel title="Temps de réponse moyen (ms)"><TimeChart kind="area" bucket={period.bucket} suffix=" ms" data={rows(t.series, (s) => ({ ms: s.avgMs }))} series={[{ key: "ms", name: "Temps moyen", color: "#3b8fd0" }]} /></Panel>
        <Panel title="Origine des erreurs" description="Distinction entre erreurs d'utilisation, défauts de l'application et pannes de services externes (IA, stockage)."><Donut data={[{ label: KIND.USER.label, value: t.byKind.USER }, { label: KIND.APP.label, value: t.byKind.APP }, { label: KIND.EXTERNAL.label, value: t.byKind.EXTERNAL }]} height={170} /></Panel>
        <Panel title="Échecs par nature" description="Compteurs sur la période.">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Importations en échec" value={fmtNumber(t.failures.imports)} /><Stat label="Générations d'exercices en échec" value={fmtNumber(t.failures.generations)} />
            <Stat label="Erreurs de sauvegarde (5xx)" value={fmtNumber(t.failures.saves)} /><Stat label="Problèmes d'authentification" value={fmtNumber(t.failures.auth)} hint="Réponses 401/403 des routes de connexion." />
            <Stat label="Échecs de connexion admin" value={fmtNumber(t.failures.adminLogins)} />
            <Stat label="Chargement de page (médiane haute)" value={t.pageLoad.samples ? `${fmtMs(t.pageLoad.p75Ms)}` : "n/d"} hint={t.pageLoad.samples ? `${t.pageLoad.samples} mesures, moyenne ${fmtMs(t.pageLoad.avgMs)}` : "Aucune mesure collectée"} />
          </dl>
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Erreurs les plus fréquentes" description="Classement par nombre d'occurrences.">
          {t.frequentErrors.length ? (
            <Table><thead><tr><Th>Route</Th><Th>Statut</Th><Th>Origine</Th><Th align="right">Fois</Th><Th>Dernière</Th></tr></thead>
              <tbody>{t.frequentErrors.map((e, i) => <tr key={i}><Td className="max-w-[220px] truncate font-mono text-xs" >{e.method} {e.route}</Td><Td>{e.status}</Td><Td>{e.kind ? <Pill tone={KIND[e.kind]?.tone}>{KIND[e.kind]?.label ?? e.kind}</Pill> : "—"}</Td><Td align="right">{e.count}</Td><Td className="whitespace-nowrap text-xs">{fmtDateTime(e.last)}</Td></tr>)}</tbody></Table>
          ) : <EmptyState title="Aucune erreur sur la période." />}
        </Panel>
        <Panel title="Routes les plus lentes" description="Par 95ᵉ percentile (au moins 3 appels).">
          {t.slowest.length ? <BarList items={t.slowest.map((r) => ({ label: `${r.method} ${r.route}`, value: r.p95Ms, sub: `${r.count} appels · moy. ${fmtMs(r.avgMs)}` }))} suffix=" ms" /> : <EmptyState title="Pas assez de requêtes mesurées." />}
        </Panel>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Services externes — fournisseur d'IA" description="Temps de réponse mesuré à chaque appel.">
          {t.externalAi.length ? (
            <Table><thead><tr><Th>Modèle</Th><Th align="right">Appels</Th><Th align="right">Temps moyen</Th><Th align="right">Échecs</Th></tr></thead><tbody>{t.externalAi.map((m) => <tr key={m.model}><Td>{m.model}</Td><Td align="right">{m.calls}</Td><Td align="right">{fmtMs(m.avgMs)}</Td><Td align="right">{m.failed}</Td></tr>)}</tbody></Table>
          ) : <EmptyState title="Aucun appel IA sur la période." />}
          <p className="mt-2 text-xs text-muted-foreground">Détail dans <Link className="underline" href={`/admin/ia?${period.query}`}>Intelligence artificielle</Link>.</p>
        </Panel>
        <Panel title="Historique des incidents" description="Alertes détectées automatiquement (ouvertes et résolues).">
          {alerts.length ? (
            <ul className="divide-y text-sm">{alerts.map((a) => <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2"><div><Pill tone={statusTone(a.status === "OPEN" ? a.severity : "RESOLVED")}>{a.status === "OPEN" ? (a.severity === "CRITICAL" ? "Critique" : "Attention") : "Résolue"}</Pill> <span className="font-medium">{a.title}</span><p className="text-xs text-muted-foreground">{a.detail}</p></div><div className="text-right text-xs text-muted-foreground"><p>{fmtDateTime(a.createdAt)}</p>{a.resolvedAt && <p>résolue {fmtDateTime(a.resolvedAt)}</p>}</div></li>)}</ul>
          ) : <EmptyState title="Aucun incident enregistré." />}
        </Panel>
      </div>

      <Notice>{t.notices.map((n) => <p key={n}>{n}</p>)}</Notice>
    </>
  );
}
