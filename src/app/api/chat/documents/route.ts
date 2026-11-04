import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { db } from "@/lib/db";

/** Documents de la bibliothèque qu'on peut joindre à un message du chat (version courante extraite). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const documents = await db.document.findMany({
      where: { userId: user.id, currentVersion: { is: { extractStatus: { in: ["READY", "PARTIAL"] } } } },
      select: { id: true, name: true, subject: { select: { name: true } } },
      orderBy: [{ subjectId: "asc" }, { name: "asc" }],
      take: 500,
    });
    return { documents: documents.map((d) => ({ id: d.id, name: d.name, subject: d.subject?.name ?? null })) };
  });
}
