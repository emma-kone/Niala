import { AssistantPage } from "@/features/admin/admin-assistant";
import { PERMISSIONS } from "@/server/admin/rbac";
import { requireAdminPage } from "@/server/admin/session";

// Assistant IA en pleine page : accessible à tout administrateur (les outils restent filtrés par rôle côté serveur).
export default async function AssistantFullPage() {
  const admin = await requireAdminPage([...PERMISSIONS]);
  return <AssistantPage adminId={admin.id} />;
}
