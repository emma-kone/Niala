import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { requireSubject } from "@/server/services/folders";

/** Liste légère des documents d'une matière (sélecteurs : liens de notes, etc.). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    await requireSubject(user.id, id);
    const documents = await db.document.findMany({
      where: { userId: user.id, subjectId: id },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
      take: 1000,
    });
    return { documents };
  });
}
