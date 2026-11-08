import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteEvent, patchEventSchema, updateEvent } from "@/server/services/agenda/agenda";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return updateEvent(user.id, (await ctx.params).id, patchEventSchema.parse(await readJson<unknown>(req)));
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    return deleteEvent(user.id, (await ctx.params).id, q.get("scope") === "occurrence" ? "occurrence" : "all", q.get("date"));
  });
}
