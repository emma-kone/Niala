import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { deleteNote, getNote, updateNote } from "@/server/services/notes";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return { note: await getNote(user.id, id) };
  });
}

const patchSchema = z
  .object({
    revision: z.number().int().min(1),
    title: z.string().max(200).optional(),
    content: z.unknown().optional(),
  })
  .refine((d) => d.title !== undefined || d.content !== undefined, { message: "Rien à enregistrer." });

/** Sauvegarde automatique : la révision lue par le client protège contre les écrasements. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`notes-save:${user.id}`, 300, 60_000);
    const { id } = await ctx.params;
    const { revision, title, content } = patchSchema.parse(await readJson<unknown>(req));
    return updateNote(user.id, id, { revision, title, content });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return deleteNote(user.id, id);
  });
}
