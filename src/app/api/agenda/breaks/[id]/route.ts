import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { deleteBreak } from "@/server/services/agenda/tasks";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => deleteBreak((await requireUser()).id, (await ctx.params).id));
}
