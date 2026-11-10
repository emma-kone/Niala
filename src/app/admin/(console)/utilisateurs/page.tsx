import Link from "next/link";
import { Notice, PageHeader, Pagination, Panel, Pill, SortHeader, statusTone, Table, Td, Th } from "@/components/admin/primitives";
import { fmtDate, fmtDateTime, fmtNumber } from "@/components/admin/format";
import { requireAdminPage } from "@/server/admin/session";
import { listUsers, PAGE_SIZE, userFilterOptions } from "@/server/admin/users";
import { ACCOUNT_STATUSES, CATEGORIES } from "@/server/analytics/definitions";
import { flat, keep, type SP } from "../_lib";

const ACTIVITY = { active7: "Actifs sur 7 jours", active30: "Actifs sur 30 jours", inactive30: "Inactifs depuis 30 jours", never: "Jamais actifs" } as const;

export default async function UsersPage({ searchParams }: { searchParams: SP }) {
  const admin = await requireAdminPage(["users.view", "users.support"]);
  const q = await flat(searchParams);
  const [res, options] = await Promise.all([listUsers(admin, q), userFilterOptions()]);
  const base = keep(q);
  const sort = res.query.sort;
  const dir = res.query.dir;
  const sh = (label: string, field: string) => <SortHeader label={label} field={field} current={sort} dir={dir} base={base} />;
  const sel = "h-9 w-full rounded-lg border bg-background px-2 text-sm";

  return (
    <>
      <PageHeader title="Utilisateurs" description={res.full ? "Comptes étudiants, activité et statut. Les contenus de travail et les conversations avec l'IA ne sont jamais affichés ici." : "Informations nécessaires au support. Les statistiques d'activité ne sont pas accessibles avec votre rôle."} />

      <Panel className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtrer les utilisateurs">
          <label className="text-xs text-muted-foreground sm:col-span-2">Recherche (nom ou e-mail)<input name="q" defaultValue={q.q} placeholder="ex. kouassi ou @esatic" className={`${sel} mt-1`} /></label>
          <label className="text-xs text-muted-foreground">Catégorie
            <select name="category" defaultValue={q.category ?? ""} className={`${sel} mt-1`}><option value="">Toutes</option>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Statut du compte
            <select name="status" defaultValue={q.status ?? ""} className={`${sel} mt-1`}><option value="">Tous</option>{Object.entries(ACCOUNT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Établissement
            <select name="institution" defaultValue={q.institution ?? ""} className={`${sel} mt-1`}><option value="">Tous</option>{options.institutions.map((i) => <option key={i}>{i}</option>)}</select></label>
          <label className="text-xs text-muted-foreground">Classe / filière
            <select name="field" defaultValue={q.field ?? ""} className={`${sel} mt-1`}><option value="">Toutes</option>{options.fields.map((i) => <option key={i}>{i}</option>)}</select></label>
          {res.full && (
            <label className="text-xs text-muted-foreground">Activité
              <select name="activity" defaultValue={q.activity ?? ""} className={`${sel} mt-1`}><option value="">Toutes</option>{Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          )}
          <label className="text-xs text-muted-foreground">Inscrit depuis le<input type="date" name="from" defaultValue={q.from} className={`${sel} mt-1`} /></label>
          <label className="text-xs text-muted-foreground">Inscrit jusqu'au<input type="date" name="to" defaultValue={q.to} className={`${sel} mt-1`} /></label>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
            <button className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">Filtrer</button>
            <Link href="/admin/utilisateurs" className="h-9 rounded-lg border px-3 text-sm leading-9 hover:bg-muted">Réinitialiser</Link>
          </div>
        </form>
      </Panel>

      {res.full && <Notice className="mb-4"><p>Les colonnes « Dernière activité » et « Sessions » reposent sur la collecte en direct des événements ; une activité antérieure n'y figure que si l'historique a été reconstitué (Paramètres d'administration).</p></Notice>}

      <Table>
        <thead>
          <tr>
            {sh("Nom", "name")}{sh("E-mail", "email")}{sh("Profil", "category")}{sh("Établissement", "institution")}{sh("Classe / filière", "field")}{sh("Inscription", "createdAt")}
            {res.full && <>{sh("Dernière activité", "lastActivity")}{sh("Sessions", "sessions")}{sh("Exercices", "exercises")}</>}
            {sh("Statut", "status")}<Th />
          </tr>
        </thead>
        <tbody>
          {res.rows.map((u) => (
            <tr key={u.id} className="hover:bg-muted/40">
              <Td className="font-medium">{u.name ?? "—"}</Td>
              <Td className="max-w-[220px] truncate">{u.email}</Td>
              <Td>{u.categoryLabel}</Td>
              <Td>{u.institution ?? "—"}</Td>
              <Td>{u.field ?? "—"}</Td>
              <Td className="whitespace-nowrap">{fmtDate(u.createdAt)}</Td>
              {res.full && <><Td className="whitespace-nowrap">{u.lastActivity ? fmtDateTime(u.lastActivity) : "—"}</Td><Td align="right">{fmtNumber(u.sessions)}</Td><Td align="right">{fmtNumber(u.exercises)}</Td></>}
              <Td><Pill tone={statusTone(u.status)}>{ACCOUNT_STATUSES[u.status as keyof typeof ACCOUNT_STATUSES] ?? u.status}</Pill></Td>
              <Td><Link href={`/admin/utilisateurs/${u.id}`} className="text-[var(--niala-accent)] underline">Fiche</Link></Td>
            </tr>
          ))}
          {!res.rows.length && <tr><Td className="py-10 text-center text-muted-foreground">Aucun utilisateur ne correspond à ces critères.</Td></tr>}
        </tbody>
      </Table>
      <Pagination page={res.page} pages={res.pages} total={res.total} base={base} size={PAGE_SIZE} />
    </>
  );
}
