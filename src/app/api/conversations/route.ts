import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { createConversation, createSchema, listConversations } from "@/server/services/chat/chat";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    const q = z.object({ scope: z.enum(["GLOBAL", "DOCUMENT"]), documentId: z.string().optional() }).parse({ scope: sp.get("scope"), documentId: sp.get("documentId") ?? undefined });
    return { conversations: await listConversations(user.id, q.scope, q.documentId) };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`conv:${user.id}`, 30, 60_000);
    const conversation = await createConversation(user.id, createSchema.parse(await readJson<unknown>(req)));
    return { conversation };
  });
}
