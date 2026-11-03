import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { getExerciseOptions } from "@/server/services/exercises/options";

/** Ce que le formulaire « Créer un exercice » peut proposer pour CE document (sections, notions, limites). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return getExerciseOptions(user.id, id);
  });
}
