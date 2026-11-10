import { Notice, PageHeader, Panel, Pill, statusTone, Table, Td, Th } from "@/components/admin/primitives";
import { fmtDate, fmtDateTime, fmtNumber } from "@/components/admin/format";
import { BackfillButton } from "@/features/admin/small-actions";
import { RolesForm, SettingsForm } from "@/features/admin/settings-forms";
import { ADMIN_ROLES, can, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS } from "@/server/admin/rbac";
import { requireAdminPage } from "@/server/admin/session";
import { listAdmins, listSettings } from "@/server/admin/settings";
import { coverage } from "@/server/admin/stats/common";
import { ABANDON_AFTER_DAYS, ACCOUNT_STATUSES, INACTIVE_AFTER_DAYS, SESSION_GAP_MIN, SUCCESS_RATIO } from "@/server/analytics/definitions";

const PERMISSION_LABELS: Record<string, string> = {
  "overview.view": "Statistiques agrégées", "users.view": "Fiches utilisateurs complètes", "users.support": "Fiche utilisateur réduite (support)", "users.manage": "Suspendre / modifier des comptes", "users.delete": "Supprimer des comptes",
  "support.view": "Consulter les demandes", "support.manage": "Traiter les demandes", "reports.view": "Consulter les rapports", "reports.export": "Exporter les rapports", "tech.view": "Supervision technique et IA",
  "comms.view": "Consulter les communications", "comms.send": "Diffuser des annonces", "settings.view": "Voir les paramètres", "settings.manage": "Modifier les paramètres", "admins.manage": "Gérer les administrateurs", "audit.view": "Journal d'activité", "data.backfill": "Reconstituer l'historique",
};

export default async function SettingsPage() {
  const admin = await requireAdminPage("settings.view");
  const [settings, cov] = await Promise.all([listSettings(), coverage()]);
  const admins = can(admin.role, "admins.manage") ? await listAdmins() : [];

  return (
    <>
      <PageHeader title="Paramètres d'administration" description="Réglages globaux, rôles, collecte des données et définitions des indicateurs." />

      <Panel title="Réglages globaux" description={can(admin.role, "settings.manage") ? "Chaque modification est confirmée et journalisée." : "Modifiables par le super administrateur uniquement."} className="mb-4">
        <SettingsForm settings={settings} editable={can(admin.role, "settings.manage")} />
      </Panel>

      <Panel title="Rôles et permissions" description="Les permissions sont vérifiées côté serveur à chaque requête, pas seulement dans l'interface." className="mb-4">
        <div className="overflow-x-auto">
          <Table>
            <thead><tr><Th>Permission</Th>{ADMIN_ROLES.map((r) => <Th key={r} className="text-center">{ROLE_LABELS[r]}</Th>)}</tr></thead>
            <tbody>
              {PERMISSIONS.map((p) => <tr key={p}><Td>{PERMISSION_LABELS[p] ?? p}</Td>{ADMIN_ROLES.map((r) => <Td key={r} className="text-center">{ROLE_PERMISSIONS[r].includes(p) ? <span aria-label="Autorisé">●</span> : <span className="text-muted-foreground/50" aria-label="Non autorisé">–</span>}</Td>)}</tr>)}
            </tbody>
          </Table>
        </div>
        <ul className="mt-3 grid gap-1 text-xs text-muted-foreground md:grid-cols-2">{ADMIN_ROLES.map((r) => <li key={r}><strong className="text-foreground">{ROLE_LABELS[r]}</strong> — {ROLE_DESCRIPTIONS[r]}</li>)}</ul>
      </Panel>

      {can(admin.role, "admins.manage") && (
        <Panel title="Administrateurs" description="Attribuez un rôle à un compte Niala existant. Un administrateur se connecte sur l'espace d'administration avec les mêmes moyens que sur la plateforme." className="mb-4">
          <RolesForm roles={ADMIN_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          <div className="mt-4">
            <Table><thead><tr><Th>Nom</Th><Th>E-mail</Th><Th>Rôle</Th><Th>Compte</Th><Th>Créé le</Th></tr></thead>
              <tbody>{admins.map((a) => <tr key={a.id}><Td>{a.name ?? "—"}</Td><Td>{a.email}</Td><Td><Pill tone="accent">{a.roleLabel}</Pill></Td><Td><Pill tone={statusTone(a.accountStatus)}>{ACCOUNT_STATUSES[a.accountStatus as keyof typeof ACCOUNT_STATUSES]}</Pill></Td><Td>{fmtDate(a.createdAt)}</Td></tr>)}</tbody></Table>
          </div>
        </Panel>
      )}

      <Panel title="Collecte des données d'usage" description="Les événements sont pseudonymisés et ne contiennent jamais de contenu de travail." className="mb-4">
        <dl className="mb-3 grid gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Collecte en direct depuis</dt><dd className="font-medium">{cov.liveSince ? fmtDateTime(cov.liveSince) : "Pas encore d'événement"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Événements en direct</dt><dd className="font-medium">{fmtNumber(cov.liveEvents)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Événements reconstitués</dt><dd className="font-medium">{fmtNumber(cov.backfilled)}</dd></div>
        </dl>
        <Notice className="mb-3">
          <p>Avant le début de la collecte, seules les tables d'origine (inscriptions, exercices, tentatives, imports, cartes, labos, appels IA) conservent un historique daté. Connexions, ouvertures de modules, consultations de cours et sessions ne sont mesurées qu'à partir de la collecte et ne peuvent pas être reconstituées.</p>
          <p>« Reconstituer l'historique » ajoute, à partir de ces tables, les événements passés correspondants (marqués « reconstitué »). Il ne crée aucune donnée fictive et peut être relancé sans doublon.</p>
        </Notice>
        {can(admin.role, "data.backfill") ? <BackfillButton /> : <p className="text-xs text-muted-foreground">Réservé au super administrateur.</p>}
      </Panel>

      <Panel title="Définitions des indicateurs" description="Centralisées dans le code (analytics/definitions.ts) pour garantir des statistiques cohérentes.">
        <dl className="space-y-3 text-sm">
          <div><dt className="font-medium">Utilisateur actif</dt><dd className="text-muted-foreground">Compte ayant réalisé au moins une action significative sur la période : ouverture d'un module, consultation d'un cours, génération ou résolution d'un exercice, import, carte mentale, message à l'assistant, exécution dans un labo, consultation de la progression, suggestion. Une connexion, une déconnexion ou un chargement de page ne comptent pas.</dd></div>
          <div><dt className="font-medium">Session</dt><dd className="text-muted-foreground">Suite d'actions d'un même utilisateur sans interruption de plus de {SESSION_GAP_MIN} minutes. Sa durée est l'écart entre sa première et sa dernière action (0 pour une action isolée). Mesurée en direct uniquement.</dd></div>
          <div><dt className="font-medium">Exercice terminé / réussi / abandonné</dt><dd className="text-muted-foreground">Terminé : tentative soumise ou corrigée. Réussi : tentative terminée dont le score atteint {Math.round(SUCCESS_RATIO * 100)} % du barème. Abandonné : tentative restée en cours sans activité depuis plus de {ABANDON_AFTER_DAYS} jours.</dd></div>
          <div><dt className="font-medium">Rétention J1 / J7 / J30</dt><dd className="text-muted-foreground">Part des inscrits ayant une action significative le 1ᵉʳ, 7ᵉ ou 30ᵉ jour calendaire (UTC) après leur inscription ; seuls les comptes assez anciens sont comptés.</dd></div>
          <div><dt className="font-medium">Utilisateur inactif</dt><dd className="text-muted-foreground">Compte actif de plus de {INACTIVE_AFTER_DAYS} jours sans action significative depuis {INACTIVE_AFTER_DAYS} jours.</dd></div>
          <div><dt className="font-medium">Mesuré, estimé, indisponible</dt><dd className="text-muted-foreground">Chaque carte d'indicateur précise sa source. Une évolution n'est affichée (« n/d » sinon) que si la période précédente est couverte par des données ; le temps d'utilisation d'un compte est une estimation ; jetons et coût d'IA ne sont pas collectés. Fuseau d'analyse : UTC (identique à Abidjan).</dd></div>
        </dl>
      </Panel>
    </>
  );
}
