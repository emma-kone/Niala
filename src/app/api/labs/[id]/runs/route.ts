import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listRuns } from "@/server/services/labs/labs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return { runs: await listRuns(user.id, (await ctx.params).id) };
  });
}
