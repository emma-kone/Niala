import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { getRequestAdmin, updateRequest } from "@/server/admin/support";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin("support.view");
    return getRequestAdmin(admin, (await ctx.params).id);
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    return updateRequest(admin, (await ctx.params).id, await readJson<unknown>(req));
  });
}
