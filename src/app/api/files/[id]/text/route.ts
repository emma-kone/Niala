import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { readingText } from "@/server/services/documents";

/** Texte extrait page par page — repli d'affichage, jamais substitué à l'original. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return readingText(user.id, id);
  });
}
