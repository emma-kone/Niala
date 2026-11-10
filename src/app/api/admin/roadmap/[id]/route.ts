import { z } from "zod";
import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { attachToRoadmap, updateRoadmapItem } from "@/server/admin/support";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    return updateRoadmapItem(admin, (await ctx.params).id, await readJson<unknown>(req));
  });
}

/** Rattache des demandes à cet élément de feuille de route (regroupement). */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    const { requestIds } = z.object({ requestIds: z.array(z.string().max(40)).min(1).max(50) }).parse(await readJson<unknown>(req));
    return attachToRoadmap(admin, (await ctx.params).id, requestIds);
  });
}
