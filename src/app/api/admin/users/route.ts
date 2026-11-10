import { handle } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { listUsers } from "@/server/admin/users";

export async function GET(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin(["users.view", "users.support"]);
    return listUsers(admin, Object.fromEntries(new URL(req.url).searchParams));
  });
}
