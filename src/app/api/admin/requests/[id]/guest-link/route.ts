import { handle } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { requireAdmin } from "@/server/admin/session";
import { renewGuestLink } from "@/server/admin/support";

/** Nouveau lien de suivi pour une demande de visiteur sans compte (l'ancien lien cesse de fonctionner). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    return renewGuestLink(admin, (await ctx.params).id, appOrigin(req));
  });
}
