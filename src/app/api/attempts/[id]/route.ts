import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { getAttempt } from "@/server/services/exercises/attempts";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return { attempt: await getAttempt(user.id, id) };
  });
}
