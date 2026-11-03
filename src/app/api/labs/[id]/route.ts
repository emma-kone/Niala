import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { deleteWorkspace, getWorkspace, updateWorkspace } from "@/server/services/labs/labs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    return { workspace: await getWorkspace(user.id, (await ctx.params).id) };
  });
}

/** Enregistrement automatique du code (et renommage). */
export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    limit(`lab-save:${user.id}`, 240, 60_000);
    return { workspace: await updateWorkspace(user.id, (await ctx.params).id, await readJson<unknown>(req)) };
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    return deleteWorkspace(user.id, (await ctx.params).id);
  });
}
