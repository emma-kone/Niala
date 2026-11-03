import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { createEmptyMap, listMaps } from "@/server/services/maps";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return { maps: await listMaps(user.id, id) };
  });
}

const schema = z.object({ title: z.string().trim().max(160).default("Nouvelle carte"), kind: z.enum(["STRUCTURE", "CONCEPT"]) });

/** Carte vide à construire à la main. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { title, kind } = schema.parse(await readJson<unknown>(req));
    return createEmptyMap(user.id, id, title, kind);
  });
}
