import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { setAccountStatus } from "@/server/admin/users";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("users.manage");
    return setAccountStatus(admin, (await ctx.params).id, await readJson<unknown>(req));
  });
}
