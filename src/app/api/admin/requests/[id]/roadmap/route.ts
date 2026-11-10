import { handle } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { detachFromRoadmap } from "@/server/admin/support";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    return detachFromRoadmap(admin, (await ctx.params).id);
  });
}
