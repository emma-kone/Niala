import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { adviceFor } from "@/server/services/progress/coaching";

/** Conseils rédigés par l'IA à partir des observations du moteur (résultat gardé 6 h pour limiter les appels). */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    limit(`coach-advice:${user.id}`, 10, 10 * 60_000);
    return adviceFor(user.id);
  });
}
