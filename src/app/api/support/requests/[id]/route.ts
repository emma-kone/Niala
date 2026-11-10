import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { getMyRequest } from "@/server/admin/support";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => ({ request: await getMyRequest((await requireUser()).id, (await ctx.params).id) }));
}
