import { handle } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { requireAdmin } from "@/server/admin/session";
import { createResetLinkFor } from "@/server/admin/users";

/** Crée un lien de réinitialisation du mot de passe (24 h, usage unique) à transmettre à l'étudiant. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("users.manage");
    return createResetLinkFor(admin, (await ctx.params).id, appOrigin(req));
  });
}
