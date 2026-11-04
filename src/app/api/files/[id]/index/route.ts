import { requireUser } from "@/lib/auth";
import { handle, limit, ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { embedPending, indexState } from "@/server/services/chat/indexing";

async function currentVersion(userId: string, id: string) {
  const doc = await db.document.findFirst({ where: { id, userId }, select: { currentVersionId: true } });
  if (!doc?.currentVersionId) throw new ApiHttpError("Document introuvable.", 404);
  return doc.currentVersionId;
}

/** État de l'indexation sémantique du document. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return indexState(user.id, await currentVersion(user.id, (await ctx.params).id));
  });
}

/** Poursuit l'indexation (par lots, dans la limite d'un budget de temps). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`index:${user.id}`, 20, 60_000);
    return embedPending(user.id, await currentVersion(user.id, (await ctx.params).id), 40_000);
  });
}
