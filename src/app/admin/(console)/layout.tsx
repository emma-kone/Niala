import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { db } from "@/lib/db";
import { can, ROLE_LABELS, sectionsFor } from "@/server/admin/rbac";
import { adminLoginPath, getAdmin } from "@/server/admin/session";
import { evaluateAlerts } from "@/server/admin/stats/tech";

export const dynamic = "force-dynamic";

// Garde de toutes les rubriques : une session d'administration valide est exigée ici (puis la permission de chaque page).
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  if (!admin) redirect(adminLoginPath);

  const canTech = can(admin.role, "tech.view");
  const canRequests = can(admin.role, "support.view");
  if (canTech) await evaluateAlerts();
  const [alerts, newRequests] = await Promise.all([
    canTech ? db.adminAlert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, severity: true, detail: true } }) : [],
    canRequests ? db.supportRequest.count({ where: { status: "RECEIVED" } }) : 0,
  ]);

  const quick = [
    ...(canRequests ? [{ href: "/admin/demandes?open=1", label: "Traiter les demandes ouvertes" }] : []),
    ...(can(admin.role, "reports.export") ? [{ href: "/admin/rapports", label: "Exporter un rapport" }] : []),
    ...(can(admin.role, "comms.send") ? [{ href: "/admin/communications", label: "Publier une annonce" }] : []),
    ...(can(admin.role, "users.view") || can(admin.role, "users.support") ? [{ href: "/admin/utilisateurs", label: "Rechercher un utilisateur" }] : []),
  ];

  return (
    <AdminShell
      admin={{ id: admin.id, name: admin.name, email: admin.email, roleLabel: ROLE_LABELS[admin.role] }}
      sections={sectionsFor(admin.role).map((s) => ({ key: s.key, href: s.href, label: s.label }))}
      bell={{ alerts, newRequests, canSeeRequests: canRequests, canSeeTech: canTech }}
      quick={quick}
    >
      {children}
    </AdminShell>
  );
}
