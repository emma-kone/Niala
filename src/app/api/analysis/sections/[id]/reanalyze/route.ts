import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { reanalyzeSection } from "@/server/services/analysis/analysis-edit";

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`reanalyze:${user.id}`, 30, 10 * 60_000);
    const { id } = await ctx.params;
    return reanalyzeSection(user.id, id);
  });
}
