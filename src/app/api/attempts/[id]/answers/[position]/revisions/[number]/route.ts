import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { ownedAttempt } from "@/server/services/exercises/attempts";
import { getRevision } from "@/server/services/workspaces/revisions";

/** Contenu d'une version antérieure : le navigateur l'applique puis l'enregistre comme travail en cours. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; position: string; number: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id, position, number } = await ctx.params;
    await ownedAttempt(user.id, id);
    return getRevision(user.id, id, z.coerce.number().int().min(1).parse(position), z.coerce.number().int().min(1).parse(number));
  });
}
