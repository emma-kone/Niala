import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listSourceCandidates } from "@/server/services/exercises/options";

/** Documents choisissables comme sources d'un exercice (les siens uniquement). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return { documents: await listSourceCandidates(user.id) };
  });
}
