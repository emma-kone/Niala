import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { receiveLocalUpload } from "@/server/services/documents";
import { getStorage } from "@/server/storage";
import { ApiHttpError } from "@/lib/api-helpers";

/** Dépôt du fichier quand le stockage est local (avec Supabase, le client dépose directement). */
export async function PUT(req: Request, ctx: { params: Promise<{ versionId: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { versionId } = await ctx.params;
    if (getStorage().driver !== "local") throw new ApiHttpError("Dépôt direct requis pour ce stockage.", 400);
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > 60 * 1024 * 1024) throw new ApiHttpError("Fichier trop volumineux.", 413);
    const data = Buffer.from(await req.arrayBuffer());
    await receiveLocalUpload(user.id, versionId, data);
    return NextResponse.json({ ok: true });
  });
}
