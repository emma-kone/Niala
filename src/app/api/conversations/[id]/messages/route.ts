import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { messageSchema, sendMessage } from "@/server/services/chat/chat";

// Un tour de chat peut enchaîner plusieurs recherches et appels au modèle.
export const maxDuration = 120;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`chat:${user.id}`, 20, 60_000);
    const { content, web } = messageSchema.parse(await readJson<unknown>(req));
    return sendMessage(user.id, (await ctx.params).id, content, { web });
  });
}
