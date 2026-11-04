import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle } from "@/lib/api-helpers";
import { ensurePdfPreview, openOriginal } from "@/server/services/documents";
import { getStorage } from "@/server/storage";

/**
 * Fichier en lecture seule (?download=1 pour le télécharger).
 * Par défaut : l'ORIGINAL. Avec ?format=pdf : le PDF de lecture (l'original lui-même pour un PDF,
 * le PDF converti à l'import pour DOCX / PPTX / TXT / MD).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const v = Number(sp.get("version") ?? 0) || undefined;
    const download = sp.get("download") === "1";
    const asPdf = sp.get("format") === "pdf";
    const { doc, version, key: originalKey } = await openOriginal(user.id, id, v);

    let key = originalKey;
    let mime = version.mime;
    let fileName = doc.originalName;
    if (asPdf && doc.type !== "pdf") {
      if (v && v !== doc.currentVersion?.number) throw new ApiHttpError("Aperçu PDF indisponible pour cette version.", 404);
      const preview = await ensurePdfPreview(user.id, id);
      if (!preview.available || !preview.key) throw new ApiHttpError(preview.reason ?? "Aperçu PDF indisponible.", 422);
      key = preview.key;
      mime = "application/pdf";
      fileName = `${doc.name}.pdf`;
    }

    const data = await getStorage().read(key);
    const asciiName = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        // Un fichier importé ne doit jamais s'exécuter dans l'origine de l'application
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  });
}
