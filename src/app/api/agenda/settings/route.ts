import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { setWeekSwap } from "@/server/services/agenda/agenda";

export async function PATCH(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { weekSwap } = z.object({ weekSwap: z.boolean() }).parse(await readJson<unknown>(req));
    return setWeekSwap(user.id, weekSwap);
  });
}
