import { BarList, Delta, EmptyState, KpiCard, Notice, PageHeader, Panel, Table, Td, Th } from "@/components/admin/primitives";
import { Donut, TimeChart } from "@/components/admin/charts";
import { fmtNumber, fmtPercent } from "@/components/admin/format";
import { requireAdminPage } from "@/server/admin/session";
import { getPedagogy } from "@/server/admin/stats/pedagogy";
import { TYPE_LABEL } from "@/server/domain/exercise-types";
import { periodOf, rows, type SP } from "../_lib";

const ORIGINS: Record<string, string> = { DOCUMENT: "À partir d'un cours", FREE: "Exercice libre", IMPORTED: "Exercice importé" };
const DIFFICULTY: Record<string, string> = { facile: "Facile", moyenne: "Moyenne", difficile: "Difficile" };
const ERRORS: Record<string, string> = { SYNTAX: "Syntaxe", LOGIC: "Logique", CONCEPT: "Notion mal comprise", METHOD: "Méthode", INSTRUCTION: "Consigne mal lue", FORGETTING: "Oubli", CARELESS: "Inattention" };

export default async function PedagogyPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage("overview.view");
  const { period } = await periodOf(searchParams);
  const p = await getPedagogy(period);
  const e = p.exercises;
  const kpi = (key: string, label: string, m: typeof e.generated, extra: object = {}) => ({ key, label, source: "table" as const, ...m, ...extra });

  return (
    <>
      <PageHeader title="Activité pédagogique" description="Utilisation pédagogique de Niala, en données agrégées et anonymisées — ce n'est pas un outil de suivi individuel des étudiants." />
      <Notice className="mb-4">{p.notices.map((n) => <p key={n}>{n}</p>)}</Notice>

      <section className="mb-6" aria-labelledby="ex"><h2 id="ex" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Exercices</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard kpi={kpi("gen", "Exercices générés", e.generated)} />
          <KpiCard kpi={kpi("start", "Commencés", e.started)} />
          <KpiCard kpi={kpi("done", "Terminés", e.completed)} />
          <KpiCard kpi={kpi("aband", "Abandonnés", e.abandoned, { hint: "Sans activité depuis plus de 7 jours." })} invert />
          <KpiCard kpi={kpi("succ", "Taux de réussite", e.successRate, { unit: "%", hint: "Exercices terminés dont le score atteint 50 % du barème." })} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Panel title="Difficulté" description={e.avgDifficulty == null ? "Aucune question créée sur la période." : `Difficulté moyenne : ${e.avgDifficulty} / 3 (1 facile · 2 moyenne · 3 difficile).`}><Donut data={e.byDifficulty.map((d) => ({ label: DIFFICULTY[d.label] ?? d.label, value: d.value }))} height={170} /></Panel>
          <Panel title="Types d'exercices les plus demandés" description="Questions créées, par type."><BarList items={e.byType.slice(0, 8).map((t) => ({ label: (TYPE_LABEL as Record<string, string>)[t.label] ?? t.label, value: t.value }))} /></Panel>
          <Panel title="Origine des exercices"><Donut data={e.byOrigin.map((d) => ({ label: ORIGINS[d.label] ?? d.label, value: d.value }))} height={170} /></Panel>
        </div>
      </section>

      <section className="mb-6" aria-labelledby="mat"><h2 id="mat" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Matières</h2>
        <Panel title="Matières les plus travaillées" description="Exercices démarrés par matière, avec la tendance par rapport à la période précédente.">
          {p.subjects.ranking.length ? (
            <Table><thead><tr><Th>Matière</Th><Th align="right">Tentatives</Th><Th align="right">Étudiants</Th><Th align="right">Tendance</Th></tr></thead>
              <tbody>{p.subjects.ranking.map((s) => <tr key={s.label}><Td className="font-medium">{s.label}</Td><Td align="right">{fmtNumber(s.value)}</Td><Td align="right">{s.users}</Td><Td align="right"><Delta change={s.change ?? null} /></Td></tr>)}</tbody></Table>
          ) : <EmptyState title="Pas assez de données pour nommer des matières.">Une matière n'est affichée que si au moins 3 étudiants différents l'ont travaillée sur la période.</EmptyState>}
          {p.subjects.others > 0 && <p className="mt-3 text-xs text-muted-foreground">Autres : {fmtNumber(p.subjects.others)} tentative(s) réparties sur {p.subjects.hiddenSubjects} matière(s) trop peu partagées pour être nommées.</p>}
        </Panel>
      </section>

      <section className="mb-6" aria-labelledby="env"><h2 id="env" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Environnements pratiques</h2>
        <Table><thead><tr><Th>Environnement</Th><Th align="right">Espaces créés</Th><Th align="right">Étudiants</Th><Th align="right">Exécutions</Th><Th align="right">Avec tests</Th><Th align="right">Tests réussis</Th><Th align="right">Erreurs de fonctionnement</Th></tr></thead>
          <tbody>{p.environments.map((x) => <tr key={x.key}><Td className="font-medium">{x.label}</Td><Td align="right">{x.workspaces}</Td><Td align="right">{x.users}</Td><Td align="right">{x.runs}</Td><Td align="right">{x.testedRuns}</Td><Td align="right">{x.passedRuns}</Td><Td align="right">{x.errors}{x.errorRate != null && <span className="text-xs text-muted-foreground"> ({fmtPercent(x.errorRate)})</span>}</Td></tr>)}</tbody></Table>
        <p className="mt-2 text-xs text-muted-foreground">Une erreur de fonctionnement est une exécution qui se termine en erreur ou par dépassement du délai : elle peut venir du code de l'étudiant autant que de l'environnement.</p>
      </section>

      <section aria-labelledby="prog"><h2 id="prog" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Progression des étudiants</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Évolution du taux de réussite" description="Part des exercices terminés atteignant 50 % du barème."><TimeChart kind="line" bucket={period.bucket} suffix=" %" data={rows(p.progress.successSeries, (s) => ({ n: s.value }))} series={[{ key: "n", name: "Taux de réussite", color: "#3fa384" }]} /></Panel>
          <Panel title="Taux de réussite par matière"><BarList items={p.progress.successBySubject.map((s) => ({ label: s.label, value: s.value, sub: `${s.extra} ex.` }))} suffix=" %" max={100} /></Panel>
          <Panel title="Compétences les plus travaillées" description="Notions rencontrées dans les réponses (≥ 3 étudiants)."><BarList items={p.progress.topConcepts.map((c) => ({ label: c.label, value: c.value, sub: `${c.users} étud.` }))} /></Panel>
          <Panel title="Difficultés les plus fréquentes" description="Notions au taux d'erreur le plus élevé (≥ 3 étudiants, ≥ 10 réponses)."><BarList items={p.progress.difficulties.map((c) => ({ label: c.label, value: c.value, sub: `${c.extra} rép.` }))} suffix=" %" max={100} /></Panel>
          <Panel title="Types d'erreurs diagnostiquées"><BarList items={p.progress.errorCategories.map((c) => ({ label: ERRORS[c.label] ?? c.label, value: c.value }))} /></Panel>
          <Panel title="Maîtrise actuelle des notions" description="État actuel, sans historique (non conservé).">
            {p.progress.masteryNow.concepts ? <p className="text-sm">Niveau moyen estimé : <strong className="text-lg">{fmtPercent(p.progress.masteryNow.avgLevel)}</strong> sur {fmtNumber(p.progress.masteryNow.concepts)} notions évaluées, chez {p.progress.masteryNow.users} étudiant(s). C'est une estimation fondée sur les réponses, avec un niveau de confiance variable.</p> : <EmptyState title="Aucune notion évaluée pour l'instant." />}
          </Panel>
        </div>
      </section>
    </>
  );
}
