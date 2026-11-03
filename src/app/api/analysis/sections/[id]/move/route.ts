import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { moveSection } from "@/server/services/analysis/analysis-edit";

const schema = z.object({ direction: z.enum(["up", "down", "indent", "outdent"]) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return moveSection(user.id, id, schema.parse(await readJson<unknown>(req)).direction);
  });
}
