import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { cancelImport } from "@/server/services/agenda/import";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => cancelImport((await requireUser()).id, (await ctx.params).id));
}
