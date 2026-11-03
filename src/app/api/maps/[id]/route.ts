import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { deleteMap, getMap, renameMap, saveMap } from "@/server/services/maps";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return { map: await getMap(user.id, id) };
  });
}

/** Sauvegarde de l'état complet (nœuds + relations) avec la révision lue par le client. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`maps-save:${user.id}`, 300, 60_000);
    const { id } = await ctx.params;
    const body = await readJson<Record<string, unknown>>(req);
    const revision = z.number().int().min(1).parse(body.revision);
    return saveMap(user.id, id, { ...body, revision });
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { title } = z.object({ title: z.string().trim().min(1).max(160) }).parse(await readJson<unknown>(req));
    return renameMap(user.id, id, title);
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return deleteMap(user.id, id);
  });
}
