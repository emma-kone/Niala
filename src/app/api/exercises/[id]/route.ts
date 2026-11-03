import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { deleteExercise, getExercise } from "@/server/services/exercises/attempts";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return { exercise: await getExercise(user.id, id) };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return deleteExercise(user.id, id);
  });
}
