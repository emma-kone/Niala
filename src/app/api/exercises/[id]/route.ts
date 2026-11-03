import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, ApiHttpError } from "@/lib/api-helpers";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const exercise = await db.legacyExercise.findFirst({ where: { id, userId: user.id } });
    if (!exercise) throw new ApiHttpError("Exercice introuvable.", 404);
    await db.legacyExercise.delete({ where: { id } });
    return { ok: true };
  });
}
