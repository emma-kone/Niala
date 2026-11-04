import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { interpret } from "@/server/diagnosis/tutor";

export const maxDuration = 120;

/** « Comprendre mon erreur » : interprétation IA validée (jamais contraire aux constats des outils) et questions de vérification. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`diag-ai:${user.id}`, 20, 60_000);
    return { report: await interpret(user.id, (await ctx.params).id) };
  });
}
