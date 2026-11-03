import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { finalizeUpload } from "@/server/services/documents";

/** Étape 3 de l'import : contrôle du fichier reçu, extraction et indexation. */
export async function POST(_req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`finalize:${user.id}`, 40, 60_000);
    const { versionId } = await ctx.params;
    return finalizeUpload(user.id, versionId);
  });
}
