import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { deleteUserAccount, getUserDetail, updateAdminInfo } from "@/server/admin/users";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin(["users.view", "users.support"]);
    return getUserDetail(admin, (await ctx.params).id);
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin("users.manage");
    return updateAdminInfo(admin, (await ctx.params).id, await readJson<unknown>(req));
  });
}

/** Suppression (anonymisation) d'un compte : l'adresse du compte doit être saisie dans le corps de la requête. */
export async function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const admin = await requireAdmin("users.delete");
    return deleteUserAccount(admin, (await ctx.params).id, await readJson<unknown>(req));
  });
}
