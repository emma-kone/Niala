import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { addLink, linkInputSchema } from "@/server/services/notes";

/** Ajoute une référence vers un document (une note peut en avoir plusieurs). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const link = linkInputSchema.parse(await readJson<unknown>(req));
    return { note: await addLink(user.id, id, link) };
  });
}
