import { handle } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { readAttachment } from "@/server/admin/support";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; index: string }> }) {
  return handle(async () => {
    await requireAdmin("support.view");
    const { id, index } = await ctx.params;
    const att = await readAttachment(id, Number(index), {});
    return new Response(new Uint8Array(att.data), { headers: { "Content-Type": att.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  });
}
