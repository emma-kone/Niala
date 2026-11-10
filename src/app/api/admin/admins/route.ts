import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { listAdmins, setAdminRole } from "@/server/admin/settings";

export async function GET() {
  return handle(async () => {
    await requireAdmin("admins.manage");
    return { admins: await listAdmins() };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin("admins.manage");
    return setAdminRole(admin, await readJson<unknown>(req));
  });
}
