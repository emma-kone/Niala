import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { readAttachment } from "@/server/admin/support";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; index: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id, index } = await ctx.params;
    const att = await readAttachment(id, Number(index), { userId: user.id });
    return new Response(new Uint8Array(att.data), { headers: { "Content-Type": att.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  });
}
