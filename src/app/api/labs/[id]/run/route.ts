import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { runWorkspace } from "@/server/services/labs/labs";

export const maxDuration = 120;

/** Exécution isolée (libre) ou tests objectifs. Limitée par utilisateur : chaque exécution lance un processus. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`lab-run:${user.id}`, 30, 60_000);
    return runWorkspace(user.id, (await ctx.params).id, await readJson<unknown>(req));
  });
}
