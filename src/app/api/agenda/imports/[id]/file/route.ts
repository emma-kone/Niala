import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { importFile } from "@/server/services/agenda/import";

/** Document d'origine d'un import. Toujours en téléchargement : son contenu n'est jamais exécuté par le navigateur. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { data, mime, fileName } = await importFile((await requireUser()).id, (await ctx.params).id);
    return new Response(new Uint8Array(data), { headers: { "Content-Type": mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, "X-Content-Type-Options": "nosniff" } });
  });
}
