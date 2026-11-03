import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { recomputeMastery, refreshRecommendations } from "@/server/services/progress/progress";

/** Recalcule la maîtrise depuis les preuves (réponses corrigées, tests) puis les recommandations. */
export async function POST() {
  return handle(async () => {
    const user = await requireUser();
    limit(`progress-recompute:${user.id}`, 6, 60_000);
    const r = await recomputeMastery(user.id);
    return { ...r, recommendations: await refreshRecommendations(user.id) };
  });
}
