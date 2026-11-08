import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { dashboard } from "@/server/services/progress/progress";
import { isDate } from "@/server/domain/schedule";

/** Tableau de bord : où j'en suis, ce qui demande mon attention, la prochaine activité. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    // La date et l'heure sont celles de l'appareil de l'étudiant ; à défaut, celles du serveur.
    const q = new URL(req.url).searchParams;
    const now = new Date();
    const date = isDate(q.get("date") ?? "") ? q.get("date")! : now.toISOString().slice(0, 10);
    const raw = Number(q.get("minutes"));
    const minutes = q.get("minutes") !== null && Number.isInteger(raw) && raw >= 0 && raw < 1440 ? raw : now.getUTCHours() * 60 + now.getUTCMinutes();
    return dashboard(user.id, { date, minutes });
  });
}
