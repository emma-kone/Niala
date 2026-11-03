import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { revealSolution } from "@/server/services/labs/labs";

/** Solution de référence : débloquée après une réussite ou 3 essais avec les tests. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return revealSolution(user.id, (await ctx.params).id);
  });
}
