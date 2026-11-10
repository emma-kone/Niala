import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { createSchedule } from "@/server/services/agenda/import";

/** Crée un emploi du temps vide, à remplir à la main (cours, pauses, plages). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const input = z.object({ label: z.string().max(80), activate: z.boolean().optional() }).parse(await readJson<unknown>(req));
    return { schedule: await createSchedule(user.id, input) };
  });
}
