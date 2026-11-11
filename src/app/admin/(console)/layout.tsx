import { redirect } from "next/navigation";
import { after } from "next/server";
import { AdminShell } from "@/components/admin/admin-shell";
import { db } from "@/lib/db";
import { can, ROLE_LABELS, sectionsFor } from "@/server/admin/rbac";
import { adminLoginPath, getAdmin } from "@/server/admin/session";
import { cached } from "@/server/admin/stats/common";
import { evaluateAlerts } from "@/server/admin/stats/tech";

export const dynamic = "force-dynamic";

const openAlerts = () => cached("admin:bell:alerts", () => db.adminAlert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, severity: true, detail: true } }), 20_000);
const newRequests = () => cached("admin:bell:requests", () => db.supportRequest.count({ where: { status: "RECEIVED" } }), 20_000);

// Garde de toutes les rubriques : une session d'administration valide est exigée ici (puis la permission de chaque page).
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  // Les lectures de la pastille de notifications partent en même temps que la vérification de la session (un seul aller-retour
  // vers la base au lieu de deux) ; elles ne sont utilisées que si le rôle y a droit.
  const [admin, alertRows, newRequestCount] = await Promise.all([getAdmin(), openAlerts(), newRequests()]);
  if (!admin) redirect(adminLoginPath);

  const canTech = can(admin.role, "tech.view");
  const canRequests = can(admin.role, "support.view");
  // L'évaluation des règles d'alerte (une dizaine de requêtes) ne retarde plus l'affichage : elle se fait après la réponse.
  if (canTech) after(() => evaluateAlerts());
  const alerts = canTech ? alertRows : [];
  const requestCount = canRequests ? newRequestCount : 0;

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
      bell={{ alerts, newRequests: requestCount, canSeeRequests: canRequests, canSeeTech: canTech }}
      quick={quick}
    >
      {children}
    </AdminShell>
  );
}
