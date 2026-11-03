import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { conceptPatchSchema, deleteConceptSource, updateConceptSource } from "@/server/services/analysis/analysis-edit";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return updateConceptSource(user.id, id, conceptPatchSchema.parse(await readJson<unknown>(req)));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return deleteConceptSource(user.id, id);
  });
}
