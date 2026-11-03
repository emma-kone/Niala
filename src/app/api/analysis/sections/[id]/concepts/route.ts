import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { addConcept, conceptInputSchema } from "@/server/services/analysis/analysis-edit";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return addConcept(user.id, id, conceptInputSchema.parse(await readJson<unknown>(req)));
  });
}
