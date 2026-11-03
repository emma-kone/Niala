import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { conceptDetail } from "@/server/services/progress/progress";

/** Preuves détaillées derrière l'estimation de maîtrise d'une notion. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return conceptDetail(user.id, (await ctx.params).id);
  });
}
