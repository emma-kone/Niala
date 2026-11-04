import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { ensurePdfPreview } from "@/server/services/documents";

/** Garantit l'existence de l'aperçu PDF (le génère au besoin) et indique s'il est disponible. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`preview:${user.id}`, 60, 60_000);
    const { id } = await ctx.params;
    const { available, source, reason } = await ensurePdfPreview(user.id, id);
    return { available, source: source ?? null, reason: reason ?? null };
  });
}
