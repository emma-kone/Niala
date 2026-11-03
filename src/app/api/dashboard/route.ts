import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { dashboard } from "@/server/services/progress/progress";

/** Tableau de bord : où j'en suis, ce qui demande mon attention, la prochaine activité. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    return dashboard(user.id);
  });
}
