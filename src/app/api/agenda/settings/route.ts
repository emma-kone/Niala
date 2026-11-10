import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, readJson } from "@/lib/api-helpers";
import { setWeekSwap } from "@/server/services/agenda/agenda";
import { setActiveSchedule } from "@/server/services/agenda/import";

const schema = z.object({
  weekSwap: z.boolean().optional(),
  /** Emploi du temps à suivre ; null = tous. */
  activeScheduleId: z.string().min(1).max(40).nullable().optional(),
});

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const input = schema.parse(await readJson<unknown>(req));
    if (input.weekSwap === undefined && input.activeScheduleId === undefined) throw new ApiHttpError("Aucune modification fournie.", 422);
    const out: Record<string, unknown> = {};
    if (input.activeScheduleId !== undefined) Object.assign(out, await setActiveSchedule(user.id, input.activeScheduleId));
    if (input.weekSwap !== undefined) Object.assign(out, await setWeekSwap(user.id, input.weekSwap));
    return out;
  });
}
