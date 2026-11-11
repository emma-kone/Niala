import { handle, readJson } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { requireAdmin } from "@/server/admin/session";
import { deleteRequests, getRequestAdmin, updateRequest } from "@/server/admin/support";

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
    return updateRequest(admin, (await ctx.params).id, await readJson<unknown>(req), appOrigin(req));
  });
}

/** Suppression par l'équipe : masquée partout, conservée pour les statistiques. */
export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    return deleteRequests(admin, { ids: [(await ctx.params).id] });
  });
}
