import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { deleteDocuments, getDocumentProperties, renameDocument } from "@/server/services/documents";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return { document: await getDocumentProperties(user.id, id) };
  });
}

const patchSchema = z.object({ name: z.string().min(1).max(200) });

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const { name } = patchSchema.parse(await readJson<unknown>(req));
    return renameDocument(user.id, id, name);
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return deleteDocuments(user.id, [id]);
  });
}
