import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader, Panel, Pill, priorityTone, statusTone } from "@/components/admin/primitives";
import { fmtBytes, fmtDateTime } from "@/components/admin/format";
import { RequestPanel } from "@/features/admin/request-panel";
import { ApiHttpError } from "@/lib/api-helpers";
import { can } from "@/server/admin/rbac";
import { requireAdminPage } from "@/server/admin/session";
import { assignableAdmins, getRequestAdmin, listRoadmap } from "@/server/admin/support";
import { MODULES, PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES, ROADMAP_STATUSES, categoryLabel } from "@/server/analytics/definitions";

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage("support.view");
  const { id } = await params;
  let r: Awaited<ReturnType<typeof getRequestAdmin>>;
  try {
    r = await getRequestAdmin(admin, id);
  } catch (e) {
    if (e instanceof ApiHttpError && e.status === 404) notFound();
    throw e;
  }
  const [admins, roadmap] = await Promise.all([assignableAdmins(), listRoadmap()]);
  const manage = can(admin.role, "support.manage");
  const canSeeUser = can(admin.role, "users.view") || can(admin.role, "users.support");

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/demandes" className="text-muted-foreground hover:underline">← Suggestions et demandes</Link></p>
      <PageHeader title={r.subject} description={`${r.reference} · ${REQUEST_TYPES[r.type as keyof typeof REQUEST_TYPES]} · reçue le ${fmtDateTime(r.createdAt)}`}
        actions={<><Pill tone={priorityTone(r.priority)}>{PRIORITIES[r.priority as keyof typeof PRIORITIES]}</Pill><Pill tone={statusTone(r.status)}>{REQUEST_STATUSES[r.status as keyof typeof REQUEST_STATUSES]}</Pill></>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Demande">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.description}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Module concerné</dt><dd>{r.module ? (MODULES[r.module as keyof typeof MODULES] ?? r.module) : "Non précisé"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Urgence indiquée</dt><dd>{r.urgency ? { LOW: "Faible", NORMAL: "Normale", HIGH: "Élevée" }[r.urgency] : "Non indiquée"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Première réponse</dt><dd>{r.firstReplyAt ? fmtDateTime(r.firstReplyAt) : "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Clôturée le</dt><dd>{r.closedAt ? fmtDateTime(r.closedAt) : "—"}</dd></div>
            </dl>
            {r.attachments.length > 0 && (
              <div className="mt-4 border-t pt-3"><p className="mb-1.5 text-xs font-semibold text-muted-foreground">Pièces jointes</p>
                <ul className="flex flex-wrap gap-2">{r.attachments.map((a) => <li key={a.index}><a className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm hover:bg-muted" href={`/api/admin/requests/${r.id}/attachments/${a.index}`} download>{a.name} <span className="text-xs text-muted-foreground">{fmtBytes(a.size)}</span></a></li>)}</ul></div>
            )}
          </Panel>

          <Panel title="Échanges" description="Les notes internes (fond jaune) ne sont jamais visibles par l'étudiant.">
            <ol className="space-y-3">
              {r.messages.map((m) => (
                <li key={m.id} className={`rounded-xl border p-3 text-sm ${m.internal ? "border-amber-500/50 bg-amber-500/10" : m.authorRole === "ADMIN" ? "border-[var(--niala-accent)]/30 bg-[var(--niala-accent)]/8" : "bg-muted/40"}`}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{m.internal ? "Note interne" : m.authorRole === "ADMIN" ? "Équipe Niala" : (r.user.name ?? "Étudiant")}{m.internal && m.authorName ? ` — ${m.authorName}` : ""}</span><time dateTime={m.createdAt.toISOString()}>{fmtDateTime(m.createdAt)}</time></div>
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
              {!r.messages.length && <li className="py-4 text-center text-sm text-muted-foreground">Aucun échange pour l'instant.</li>}
            </ol>
          </Panel>

          {manage ? (
            <RequestPanel id={r.id} status={r.status} priority={r.priority} assigneeId={r.assigneeId} admins={admins.map((a) => ({ id: a.id, label: a.name ?? a.email }))} roadmap={roadmap.map((i) => ({ id: i.id, title: i.title }))} currentRoadmap={r.roadmapItem?.id ?? null} similar={r.similar.map((s) => ({ id: s.id, reference: s.reference, subject: s.subject, score: s.score, grouped: !!s.roadmapItemId }))} defaultTitle={r.subject} />
          ) : <Notice><p>Votre rôle permet de consulter cette demande mais pas d'y répondre ni de la modifier.</p></Notice>}
        </div>

        <aside className="space-y-4">
          <Panel title="Étudiant">
            <p className="text-sm font-medium">{r.user.name ?? "—"}</p>
            <p className="break-all text-sm text-muted-foreground">{r.user.email}</p>
            <p className="mt-2 text-xs text-muted-foreground">{categoryLabel(r.user.profile?.category)}{r.user.profile?.institution ? ` · ${r.user.profile.institution}` : ""}{r.user.profile?.field ? ` · ${r.user.profile.field}` : ""}</p>
            {canSeeUser && <Link href={`/admin/utilisateurs/${r.user.id}`} className="mt-3 inline-block text-sm text-[var(--niala-accent)] underline">Ouvrir la fiche utilisateur</Link>}
          </Panel>
          <Panel title="Suivi">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Responsable</dt><dd>{r.assignee ? (r.assignee.name ?? r.assignee.email) : "Non assignée"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Feuille de route</dt><dd className="text-right">{r.roadmapItem ? <>{r.roadmapItem.title}<br /><Pill tone={statusTone(r.roadmapItem.status)}>{ROADMAP_STATUSES[r.roadmapItem.status as keyof typeof ROADMAP_STATUSES]}</Pill></> : "Aucun"}</dd></div>
            </dl>
          </Panel>
        </aside>
      </div>
    </>
  );
}
