import Link from "next/link";
import { PageHeader, Panel } from "@/components/admin/primitives";
import { getAdmin } from "@/server/admin/session";
import { landingFor } from "@/server/admin/rbac";

export default async function AccessDeniedPage() {
  const admin = await getAdmin();
  return (
    <>
      <PageHeader title="Accès refusé" />
      <Panel>
        <p className="text-sm">Votre rôle ne permet pas de consulter cette rubrique. La tentative a été consignée dans le journal d'activité.</p>
        {admin && <Link href={landingFor(admin.role)} className="mt-4 inline-flex rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">Retourner à une rubrique autorisée</Link>}
      </Panel>
    </>
  );
}
