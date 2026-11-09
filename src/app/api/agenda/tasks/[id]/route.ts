import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteTask, patchTaskSchema, updateTask } from "@/server/services/agenda/tasks";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => ({ task: await updateTask((await requireUser()).id, (await ctx.params).id, patchTaskSchema.parse(await readJson<unknown>(req))) }));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => deleteTask((await requireUser()).id, (await ctx.params).id));
}
