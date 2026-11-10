import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { replyToRequest } from "@/server/admin/support";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    return replyToRequest(admin, (await ctx.params).id, await readJson<unknown>(req));
  });
}
