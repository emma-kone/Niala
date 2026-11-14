import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { isDate } from "@/server/domain/schedule";
import { resolveActivityDay } from "@/server/domain/streak";
import { getStreak } from "@/server/services/progress/streak";

/** Série de jours d'activité de l'étudiant, pour l'indicateur présent sur toutes les pages. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    // Date de l'appareil de l'étudiant ; à défaut (ou si elle est incohérente), celle du serveur.
    const claimed = new URL(req.url).searchParams.get("date");
    const today = resolveActivityDay(claimed && isDate(claimed) ? claimed : null, new Date());
    return { streak: await getStreak(user.id, today) };
  });
}
