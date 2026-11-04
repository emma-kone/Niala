import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, limit, readJson } from "@/lib/api-helpers";
import { MAX_ATTACHMENTS } from "@/server/services/chat/attachments";
import { messageSchema, sendMessage, type ChatEvent, type SendOptions } from "@/server/services/chat/chat";

// Un tour de chat peut enchaîner plusieurs recherches et appels au modèle.
export const maxDuration = 120;

/**
 * Deux formes de requête :
 *  - JSON { content, web } : réponse JSON classique ;
 *  - multipart (content, web, libraryDocumentIds, files) : avec pièces jointes.
 * Avec l'en-tête `Accept: application/x-ndjson`, la réponse est un FLUX de lignes JSON
 * ({type:"status"|"delta"}… puis {type:"done", ...} ou {type:"error"}) : l'étudiant voit le texte se rédiger.
 */
async function parse(req: Request): Promise<{ content: string; web?: boolean; options: SendOptions }> {
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const { content, web } = messageSchema.parse(await readJson<unknown>(req));
    return { content, web, options: {} };
  }
  const form = await req.formData().catch(() => {
    throw new ApiHttpError("Formulaire invalide.", 400);
  });
  const { content, web } = messageSchema.parse({ content: form.get("content"), web: form.get("web") === "1" ? true : form.get("web") === "0" ? false : undefined });
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  let libraryDocumentIds: string[] = [];
  try {
    const raw = JSON.parse(String(form.get("libraryDocumentIds") ?? "[]"));
    if (Array.isArray(raw)) libraryDocumentIds = raw.filter((x): x is string => typeof x === "string").slice(0, MAX_ATTACHMENTS);
  } catch {
    throw new ApiHttpError("Liste de documents invalide.", 400);
  }
  return { content, web, options: { files, libraryDocumentIds } };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const streaming = (req.headers.get("accept") ?? "").includes("application/x-ndjson");
  if (!streaming) {
    return handle(async () => {
      const user = await requireUser();
      limit(`chat:${user.id}`, 20, 60_000);
      const { content, web, options } = await parse(req);
      return sendMessage(user.id, (await ctx.params).id, content, { ...options, web });
    });
  }

  // Les erreurs de validation (auth, limite, fichier refusé) sont renvoyées AVANT d'ouvrir le flux, avec leur vrai code HTTP.
  let prepared: { userId: string; id: string; content: string; web?: boolean; options: SendOptions };
  try {
    const user = await requireUser();
    limit(`chat:${user.id}`, 20, 60_000);
    const { content, web, options } = await parse(req);
    prepared = { userId: user.id, id: (await ctx.params).id, content, web, options };
  } catch (err) {
    return handle(async () => {
      throw err;
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      req.signal.addEventListener("abort", () => (closed = true));
      try {
        const reply = await sendMessage(prepared.userId, prepared.id, prepared.content, { ...prepared.options, web: prepared.web, emit: (e: ChatEvent) => send(e) });
        send({ type: "done", ...reply });
      } catch (err) {
        const status = err instanceof ApiHttpError ? err.status : 500;
        const message = err instanceof ApiHttpError ? err.message : "Une erreur interne est survenue.";
        if (!(err instanceof ApiHttpError)) console.error("[chat stream]", err);
        send({ type: "error", error: message, status });
      } finally {
        if (!closed) controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" } });
}
