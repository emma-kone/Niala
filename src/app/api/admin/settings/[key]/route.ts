import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { updateSetting } from "@/server/admin/settings";

export async function PUT(req: Request, ctx: { params: Promise<{ key: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("settings.manage");
    const { value } = await readJson<{ value?: unknown }>(req);
    return updateSetting(admin, (await ctx.params).key, value);
  });
}
