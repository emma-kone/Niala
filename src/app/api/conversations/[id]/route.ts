import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteConversation, getConversation, renameConversation } from "@/server/services/chat/chat";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    return getConversation(user.id, (await ctx.params).id);
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const { title } = z.object({ title: z.string().min(1).max(200) }).parse(await readJson<unknown>(req));
    return renameConversation(user.id, (await ctx.params).id, title);
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    return deleteConversation(user.id, (await ctx.params).id);
  });
}
