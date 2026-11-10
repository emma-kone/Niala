import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { replyAsUser } from "@/server/admin/support";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`support-reply:${user.id}`, 20, 60 * 60_000);
    const { body } = await readJson<{ body?: unknown }>(req);
    return replyAsUser(user.id, (await ctx.params).id, body);
  });
}
