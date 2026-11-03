import { requireUser } from "@/lib/auth";
import { handle, ApiHttpError } from "@/lib/api-helpers";
import { restoreRevision } from "@/server/services/maps";

/** Revient à une version précédente (l'état actuel est lui-même conservé comme version). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; number: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id, number } = await ctx.params;
    const n = Number(number);
    if (!Number.isInteger(n) || n < 1) throw new ApiHttpError("Version invalide.", 422);
    return { map: await restoreRevision(user.id, id, n) };
  });
}
