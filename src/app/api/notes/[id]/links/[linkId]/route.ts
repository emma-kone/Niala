import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { removeLink } from "@/server/services/notes";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id, linkId } = await ctx.params;
    return { note: await removeLink(user.id, id, linkId) };
  });
}
