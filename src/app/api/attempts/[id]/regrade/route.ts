import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { regradePending } from "@/server/services/exercises/attempts";

export const maxDuration = 300;

/** Corrige les questions rédigées restées « non corrigées » (IA indisponible lors de la soumission). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`regrade:${user.id}`, 20, 10 * 60_000);
    const { id } = await ctx.params;
    return { attempt: await regradePending(user.id, id) };
  });
}
