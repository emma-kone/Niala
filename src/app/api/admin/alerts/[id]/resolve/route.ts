import { handle } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { resolveAlert } from "@/server/admin/stats/tech";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("tech.view");
    await resolveAlert(admin, (await ctx.params).id);
    return { ok: true };
  });
}
