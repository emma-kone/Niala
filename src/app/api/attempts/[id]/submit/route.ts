import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { submitAttempt } from "@/server/services/exercises/attempts";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`submit:${user.id}`, 30, 10 * 60_000);
    const { id } = await ctx.params;
    return { attempt: await submitAttempt(user.id, id) };
  });
}
