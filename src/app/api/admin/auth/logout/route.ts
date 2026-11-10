import { handle } from "@/lib/api-helpers";
import { audit } from "@/server/admin/audit";
import { clearAdminCookie, getAdmin } from "@/server/admin/session";

export async function POST() {
  return handle(async () => {
    const admin = await getAdmin();
    if (admin) await audit(admin, "admin.logout", { targetType: "admin", targetId: admin.id });
    await clearAdminCookie();
    return { ok: true };
  });
}
