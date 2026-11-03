import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { updateRecommendation } from "@/server/services/progress/progress";

const schema = z.object({ status: z.enum(["DISMISSED", "DONE"]) });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { status } = schema.parse(await readJson<unknown>(req));
    return updateRecommendation(user.id, (await ctx.params).id, status);
  });
}
