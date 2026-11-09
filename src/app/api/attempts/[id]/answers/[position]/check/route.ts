import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { checkAnswer } from "@/server/services/exercises/attempts";

export const maxDuration = 120;

/** Correction immédiate d'une question : enregistre la réponse et renvoie la tentative avec son explication. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; position: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`check:${user.id}`, 120, 10 * 60_000);
    const { id, position } = await ctx.params;
    const { value } = await readJson<{ value: unknown }>(req);
    return { attempt: await checkAnswer(user.id, id, Number(position), value ?? null) };
  });
}
