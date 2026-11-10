import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listMyReplies } from "@/server/admin/support";

/** Réponses de l'équipe Niala reçues par l'étudiant connecté. */
export async function GET() {
  return handle(async () => ({ replies: await listMyReplies((await requireUser()).id) }));
}
