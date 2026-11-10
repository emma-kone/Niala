import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { addInternalNote } from "@/server/admin/support";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    const { body } = await readJson<{ body?: unknown }>(req);
    return addInternalNote(admin, (await ctx.params).id, body);
  });
}
