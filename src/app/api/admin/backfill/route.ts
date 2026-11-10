import { handle } from "@/lib/api-helpers";
import { audit } from "@/server/admin/audit";
import { requireAdmin } from "@/server/admin/session";
import { clearStatsCache } from "@/server/admin/stats/common";
import { backfillAnalytics } from "@/server/analytics/backfill";

export const maxDuration = 300;

/** Reconstitue l'historique d'événements depuis les tables d'origine (rejouable sans doublon). */
export async function POST() {
  return handle(async () => {
    const admin = await requireAdmin("data.backfill");
    const results = await backfillAnalytics();
    clearStatsCache();
    await audit(admin, "data.backfill", { targetType: "analytics", detail: { inserted: Object.fromEntries(results.map((r) => [r.type, r.inserted])) } });
    return { results };
  });
}
