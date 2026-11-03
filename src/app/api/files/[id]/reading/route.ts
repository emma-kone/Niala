import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { recordReading } from "@/server/services/documents";

const schema = z.object({ page: z.number().int().min(1).max(100_000) });

/** Mémorise la dernière page lue (reprise de lecture). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`reading:${user.id}`, 120, 60_000);
    const { id } = await ctx.params;
    const { page } = schema.parse(await readJson<unknown>(req));
    return recordReading(user.id, id, page);
  });
}
