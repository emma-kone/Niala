import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteSchedule, renameSchedule } from "@/server/services/agenda/import";

/** Abandon d'un import non validé, ou suppression d'un emploi du temps importé (ses cours, pauses et périodes). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => deleteSchedule((await requireUser()).id, (await ctx.params).id));
}

/** Renommer un emploi du temps importé. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { label } = z.object({ label: z.string().max(80) }).parse(await readJson<unknown>(req));
    return renameSchedule(user.id, (await ctx.params).id, label);
  });
}
