import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteSession, setSessionDone } from "@/server/services/agenda/tasks";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => setSessionDone((await requireUser()).id, (await ctx.params).id, z.object({ done: z.boolean() }).parse(await readJson<unknown>(req)).done));
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => deleteSession((await requireUser()).id, (await ctx.params).id));
}
