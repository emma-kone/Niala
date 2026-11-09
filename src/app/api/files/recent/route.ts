import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listRecentDocuments } from "@/server/services/documents";

/** Derniers documents ouverts par l'étudiant. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return { documents: await listRecentDocuments(user.id) };
  });
}
