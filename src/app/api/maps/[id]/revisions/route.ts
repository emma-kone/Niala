import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { createRestorePoint } from "@/server/services/maps";

/** Crée un point de restauration de la carte dans son état actuel. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return createRestorePoint(user.id, id);
  });
}
