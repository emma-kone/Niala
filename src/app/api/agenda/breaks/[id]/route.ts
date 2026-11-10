import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteBreak, patchBreakSchema, updateBreak } from "@/server/services/agenda/tasks";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => ({ break: await updateBreak((await requireUser()).id, (await ctx.params).id, patchBreakSchema.parse(await readJson<unknown>(req))) }));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => deleteBreak((await requireUser()).id, (await ctx.params).id));
}
