import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { openOriginal } from "@/server/services/documents";
import { getStorage } from "@/server/storage";

/** Fichier ORIGINAL en lecture seule (?download=1 pour le télécharger). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const v = Number(sp.get("version") ?? 0) || undefined;
    const download = sp.get("download") === "1";
    const { doc, version, key } = await openOriginal(user.id, id, v);

    const data = await getStorage().read(key);
    const asciiName = doc.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": version.mime,
        "Content-Length": String(data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
        // Un fichier importé ne doit jamais s'exécuter dans l'origine de l'application
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  });
}
