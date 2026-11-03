import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { addSection } from "@/server/services/analysis/analysis-edit";

const schema = z.object({
  parentId: z.string().min(1).nullable().default(null),
  afterId: z.string().min(1).nullable().optional(),
  label: z.string().trim().min(1).max(160),
  numbering: z.string().trim().max(20).nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return addSection(user.id, id, schema.parse(await readJson<unknown>(req)));
  });
}
