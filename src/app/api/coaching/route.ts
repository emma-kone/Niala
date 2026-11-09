import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { dismissInsight, getCoaching } from "@/server/services/progress/coaching";

/** Conseils pédagogiques de l'étudiant connecté, calculés à la demande à partir de ses activités réelles. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const max = z.coerce.number().int().min(1).max(12).catch(8).parse(new URL(req.url).searchParams.get("max") ?? 8);
    return getCoaching(user.id, { max });
  });
}

/** Écarte un conseil pour 7 jours. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`coach-dismiss:${user.id}`, 60, 60_000);
    return dismissInsight(user.id, z.object({ key: z.string().min(1).max(200) }).parse(await readJson<unknown>(req)).key);
  });
}
