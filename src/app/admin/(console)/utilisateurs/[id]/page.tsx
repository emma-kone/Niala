import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, Panel, Pill, Stat, statusTone, Table, Td, Th } from "@/components/admin/primitives";
import { TimeChart } from "@/components/admin/charts";
import { fmtDate, fmtDateTime, fmtMinutes, fmtNumber, fmtPercent } from "@/components/admin/format";
import { UserActions } from "@/features/admin/user-actions";
import { ApiHttpError } from "@/lib/api-helpers";
import { AUDIT_ACTIONS } from "@/server/admin/audit";
import { can } from "@/server/admin/rbac";
import { requireAdminPage } from "@/server/admin/session";
import { getUserDetail } from "@/server/admin/users";
import { ACCOUNT_STATUSES, MODULES, REQUEST_STATUSES } from "@/server/analytics/definitions";

const EVENT_LABELS: Record<string, string> = {
  "account.register": "Inscription", "auth.login": "Connexion", "auth.logout": "Déconnexion", "module.open": "Ouverture d'un module", "course.view": "Consultation d'un cours",
  "exercise.generate": "Génération d'un exercice", "exercise.start": "Début d'un exercice", "exercise.complete": "Fin d'un exercice", "document.import": "Import d'un document", "exercise.import": "Import d'exercices",
  "map.create": "Création d'une carte mentale", "assistant.message": "Message à l'assistant IA", "lab.run": "Exécution dans un labo", "lab.create": "Création d'un espace de labo", "progress.view": "Consultation de la progression", "suggestion.submit": "Envoi d'une suggestion",
};
const ERROR_LABELS: Record<string, string> = { SYNTAX: "Syntaxe", LOGIC: "Logique", CONCEPT: "Notion", METHOD: "Méthode", INSTRUCTION: "Consigne", FORGETTING: "Oubli", CARELESS: "Inattention" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage(["users.view", "users.support"]);
  const { id } = await params;
  let d: Awaited<ReturnType<typeof getUserDetail>>;
  try {
    d = await getUserDetail(admin, id);
  } catch (e) {
    if (e instanceof ApiHttpError && e.status === 404) notFound();
    throw e;
  }
  const i = d.info;
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-b-0"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 truncate text-right font-medium">{v}</dd></div>
  );

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/utilisateurs" className="text-muted-foreground hover:underline">← Utilisateurs</Link></p>
      <PageHeader title={i.name ?? i.email} description={i.email} actions={<Pill tone={statusTone(i.status)}>{ACCOUNT_STATUSES[i.status as keyof typeof ACCOUNT_STATUSES]}</Pill>} />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Informations générales" className="lg:col-span-2">
          <dl>
            {row("Type de profil", i.categoryLabel)}{row("Établissement", i.institution ?? "—")}{row("Filière", i.field ?? "—")}{row("Classe", i.className ?? "—")}{row("Niveau d'études", i.level ?? "—")}
            {row("Date d'inscription", fmtDate(i.createdAt))}{row("Connexion", i.signIn)}{row("Statut du compte", ACCOUNT_STATUSES[i.status as keyof typeof ACCOUNT_STATUSES])}
            {i.status !== "ACTIVE" && row("Motif interne", i.statusReason ?? "—")}
          </dl>
        </Panel>
        <Panel title="Actions administratives">
          {can(admin.role, "users.manage") || can(admin.role, "users.delete") ? (
            <UserActions id={i.id} email={i.email} name={i.name} status={i.status} category={i.category} institution={i.institution} field={i.field} className={i.className} canManage={can(admin.role, "users.manage")} canDelete={can(admin.role, "users.delete")} />
          ) : <p className="text-sm text-muted-foreground">Votre rôle ne permet pas de modifier ce compte.</p>}
          <p className="mt-3 text-xs text-muted-foreground">Chaque action demande une confirmation et est enregistrée dans le journal d'audit.</p>
        </Panel>
      </div>

      {d.activity && d.pedagogy && d.progress ? (
        <>
          <Notice className="mb-4"><p>Cette fiche affiche des indicateurs d'usage, jamais les conversations avec l'IA, les notes, ni le contenu des cours ou des réponses.</p></Notice>
          <section className="mb-4" aria-labelledby="act"><h2 id="act" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activité</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="Dernière connexion" value={d.activity.lastLogin ? fmtDateTime(d.activity.lastLogin) : "—"} hint="Connexions collectées en direct uniquement." />
              <Stat label="Sessions" value={fmtNumber(d.activity.sessions)} hint={d.activity.sessionRule} />
              <Stat label="Jours d'activité" value={fmtNumber(d.activity.daysActive)} />
              <Stat label="Fréquence" value={fmtPercent(d.activity.activeDaysShare)} hint="Part des jours depuis l'inscription avec au moins une action." />
              <Stat label="Temps d'utilisation (estimé)" value={fmtMinutes(d.activity.estimatedMinutes)} hint="Estimation : somme des durées de session." />
              <Stat label="Première activité" value={d.activity.firstActivity ? fmtDate(d.activity.firstActivity) : "—"} />
            </div>
            <Panel title="Historique des activités importantes" className="mt-3" description="Les 30 dernières actions (type et module seulement).">
              {d.activity.events.length ? (
                <ul className="divide-y text-sm">
                  {d.activity.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span>{EVENT_LABELS[e.type] ?? e.type}{e.module && <span className="text-muted-foreground"> · {MODULES[e.module as keyof typeof MODULES] ?? e.module}</span>}{!e.ok && <span className="ml-2"><Pill tone="bad">échec</Pill></span>}{e.source === "BACKFILL" && <span className="ml-2"><Pill>reconstitué</Pill></span>}</span><span className="text-xs text-muted-foreground">{fmtDateTime(e.createdAt)}</span></li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Aucun événement collecté pour ce compte.</p>}
            </Panel>
          </section>

          <section className="mb-4" aria-labelledby="ped"><h2 id="ped" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Utilisation pédagogique</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
              <Stat label="Exercices réalisés" value={fmtNumber(d.pedagogy.exercisesDone)} />
              <Stat label="Réussis" value={fmtNumber(d.pedagogy.exercisesPassed)} tone="good" />
              <Stat label="Échoués" value={fmtNumber(d.pedagogy.exercisesFailed)} />
              <Stat label="En cours" value={fmtNumber(d.pedagogy.exercisesOpen)} />
              <Stat label="Cours consultés" value={fmtNumber(d.pedagogy.coursesViewed)} hint="Collecte en direct." />
              <Stat label="Documents importés" value={fmtNumber(d.pedagogy.documentsImported)} />
              <Stat label="Cartes mentales" value={fmtNumber(d.pedagogy.mapsCreated)} />
              {d.pedagogy.environments.map((e) => <Stat key={e.kind} label={e.kind === "SQL" ? "Labo SQL" : "Labo de code"} value={`${e.workspaces} esp. · ${e.runs} exéc.`} />)}
            </div>
            <Panel title="Matières travaillées" className="mt-3">
              {d.pedagogy.subjects.length ? (
                <Table><thead><tr><Th>Matière</Th><Th align="right">Exercices</Th><Th align="right">Tentatives terminées</Th><Th align="right">Réussite</Th></tr></thead>
                  <tbody>{d.pedagogy.subjects.map((s) => <tr key={s.name}><Td>{s.name}</Td><Td align="right">{s.exercises}</Td><Td align="right">{s.done}</Td><Td align="right">{fmtPercent(s.successRate)}</Td></tr>)}</tbody></Table>
              ) : <p className="text-sm text-muted-foreground">Aucune matière travaillée.</p>}
            </Panel>
          </section>

          <section className="mb-4" aria-labelledby="prog"><h2 id="prog" className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Progression</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Évolution des résultats" description="Score des 20 dernières tentatives terminées (en % du barème).">
                <TimeChart kind="line" bucket="day" suffix=" %" data={d.progress.results.map((r) => ({ bucket: new Date(r.at ?? 0).toISOString(), p: r.percent }))} series={[{ key: "p", name: "Résultat" }]} height={200} />
              </Panel>
              <Panel title="Compétences et difficultés">
                <div className="space-y-4 text-sm">
                  <div><p className="mb-1 text-xs font-semibold text-muted-foreground">Compétences les plus travaillées</p>{d.progress.skills.length ? <div className="flex flex-wrap gap-1.5">{d.progress.skills.map((s) => <Pill key={s.name} tone="accent">{s.name} · {s.answers}</Pill>)}</div> : <p className="text-muted-foreground">Pas encore de donnée.</p>}</div>
                  <div><p className="mb-1 text-xs font-semibold text-muted-foreground">Difficultés récurrentes détectées</p>{d.progress.difficulties.length ? <div className="flex flex-wrap gap-1.5">{d.progress.difficulties.map((s) => <Pill key={s.name} tone="warn">{s.name} · {s.errorRate} % d'erreurs</Pill>)}</div> : <p className="text-muted-foreground">Aucune difficulté récurrente détectée (au moins 3 réponses et 50 % d'erreurs sur une notion).</p>}</div>
                  <div><p className="mb-1 text-xs font-semibold text-muted-foreground">Types d'erreurs diagnostiquées</p>{d.progress.errorCategories.length ? <div className="flex flex-wrap gap-1.5">{d.progress.errorCategories.map((s) => <Pill key={s.category}>{ERROR_LABELS[s.category] ?? s.category} · {s.count}</Pill>)}</div> : <p className="text-muted-foreground">Aucun diagnostic.</p>}</div>
                </div>
              </Panel>
            </div>
          </section>
        </>
      ) : <Notice className="mb-4"><p>Votre rôle (support) donne accès aux informations de compte et aux demandes, pas aux statistiques d'activité.</p></Notice>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Demandes de cet utilisateur">
          {d.requests.length ? (
            <ul className="divide-y text-sm">{d.requests.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 py-2"><Link href={`/admin/demandes/${r.id}`} className="min-w-0 truncate underline"><span className="font-mono text-xs">{r.reference}</span> {r.subject}</Link><Pill tone={statusTone(r.status)}>{REQUEST_STATUSES[r.status as keyof typeof REQUEST_STATUSES]}</Pill></li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">Aucune demande.</p>}
        </Panel>
        <Panel title="Historique des actions administratives">
          {d.history.length ? (
            <ul className="divide-y text-sm">{d.history.map((h) => <li key={h.id} className="py-2"><div className="flex justify-between gap-3"><span className="font-medium">{AUDIT_ACTIONS[h.action] ?? h.action}</span><span className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</span></div><p className="text-xs text-muted-foreground">par {h.actorEmail ?? "—"}{(h.detail as { reason?: string } | null)?.reason ? ` · motif : ${(h.detail as { reason: string }).reason}` : ""}</p></li>)}</ul>
          ) : <p className="text-sm text-muted-foreground">Aucune action enregistrée.</p>}
        </Panel>
      </div>
    </>
  );
}
