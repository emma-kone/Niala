import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { hintFor } from "@/server/services/labs/labs";

export const maxDuration = 60;

/** Indice progressif (niveaux 1 à 3) : ne révèle jamais la solution. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`lab-hint:${user.id}`, 20, 10 * 60_000);
    return hintFor(user.id, (await ctx.params).id, await readJson<unknown>(req).catch(() => ({})));
  });
}
