import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteExercise, getExercise, setExerciseSaved } from "@/server/services/exercises/attempts";

const patchSchema = z.object({ saved: z.boolean() });

/** « Conserver » un exercice ponctuel dans Mes exercices (ou l'en retirer). */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return setExerciseSaved(user.id, id, patchSchema.parse(await readJson<unknown>(req)).saved);
  });
}

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
