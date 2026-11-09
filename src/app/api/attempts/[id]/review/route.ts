import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { reviewAttempt } from "@/server/services/exercises/review";

export const maxDuration = 120;

/** Bilan détaillé rédigé par l'IA après la correction (conservé : un second appel renvoie le même). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`review:${user.id}`, 30, 10 * 60_000);
    return { attempt: await reviewAttempt(user.id, (await ctx.params).id) };
  });
}
