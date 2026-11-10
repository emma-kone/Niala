import { EmptyState, Notice, PageHeader, Panel, Pill, Table, Td, Th } from "@/components/admin/primitives";
import { fmtDateTime, fmtNumber } from "@/components/admin/format";
import { AnnouncementForm } from "@/features/admin/announcement-form";
import { ANNOUNCEMENT_KINDS, audienceOptions, listAnnouncements } from "@/server/admin/comms";
import { can } from "@/server/admin/rbac";
import { requireAdminPage } from "@/server/admin/session";
import { CATEGORIES } from "@/server/analytics/definitions";

const KIND_TONE = { INFO: "info", FEATURE: "good", MAINTENANCE: "warn", ALERT: "bad" } as const;

export default async function CommunicationsPage() {
  const admin = await requireAdminPage("comms.view");
  const [history, options] = await Promise.all([listAnnouncements(), audienceOptions()]);
  const audienceText = (a: unknown) => {
    const x = a as { categories?: string[]; institutions?: string[] };
    const parts = [x.categories?.map((c) => CATEGORIES[c as keyof typeof CATEGORIES] ?? c).join(", "), x.institutions?.join(", ")].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Tous les comptes actifs";
  };

  return (
    <>
      <PageHeader title="Notifications et communications" description="Annonces, informations de maintenance et alertes importantes envoyées aux étudiants. Elles apparaissent dans Niala (cloche de notifications)." />
      {can(admin.role, "comms.send") ? (
        <Panel title="Nouvelle annonce" description="Rédaction, aperçu avec le nombre réel de destinataires, puis confirmation avant diffusion." className="mb-4">
          <AnnouncementForm institutions={options.institutions} />
        </Panel>
      ) : <Notice className="mb-4"><p>Votre rôle permet de consulter les communications mais pas d'en diffuser.</p></Notice>}
      <Panel title="Historique des communications">
        {history.length ? (
          <Table><thead><tr><Th>Date</Th><Th>Type</Th><Th>Titre</Th><Th>Destinataires visés</Th><Th align="right">Notifiés</Th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><Td className="whitespace-nowrap">{fmtDateTime(h.createdAt)}</Td><Td><Pill tone={KIND_TONE[h.kind as keyof typeof KIND_TONE]}>{ANNOUNCEMENT_KINDS[h.kind as keyof typeof ANNOUNCEMENT_KINDS]}</Pill></Td><Td className="max-w-[320px]"><span className="font-medium">{h.title}</span><span className="block truncate text-xs text-muted-foreground">{h.body}</span></Td><Td>{audienceText(h.audience)}</Td><Td align="right">{fmtNumber(h.recipientCount)}</Td></tr>)}</tbody></Table>
        ) : <EmptyState title="Aucune annonce diffusée pour l'instant." />}
      </Panel>
    </>
  );
}
