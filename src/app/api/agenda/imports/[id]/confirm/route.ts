import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { confirmImport, confirmSchema } from "@/server/services/agenda/import";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return confirmImport(user.id, (await ctx.params).id, confirmSchema.parse(await readJson<unknown>(req)));
  });
}
