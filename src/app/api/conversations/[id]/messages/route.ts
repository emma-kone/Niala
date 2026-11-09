import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, limit, readJson } from "@/lib/api-helpers";
import { messageSchema, sendMessage, takeLastTurn, type ChatEvent } from "@/server/services/chat/chat";
import { beginTurn, stopTurn } from "@/server/services/chat/turns";

// Un tour de chat peut enchaîner plusieurs recherches et appels au modèle.
export const maxDuration = 120;

/**
 * Par défaut, réponse JSON classique. Avec l'en-tête `Accept: application/x-ndjson`, la réponse est un flux de lignes JSON
 * ({type:"status"|"delta"}… puis {type:"done", ...} ou {type:"error"}) : l'étudiant voit le texte se rédiger.
 */
/** Interrompt la génération en cours de cette conversation. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return { stopped: stopTurn((await ctx.params).id, user.id) };
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(req.headers.get("accept") ?? "").includes("application/x-ndjson")) {
    return handle(async () => {
      const user = await requireUser();
      limit(`chat:${user.id}`, 20, 60_000);
      const { content, web, documentIds, regenerate } = messageSchema.parse(await readJson<unknown>(req));
      const id = (await ctx.params).id;
      return sendMessage(user.id, id, regenerate ? await takeLastTurn(user.id, id) : content, { web, documentIds, defer: after });
    });
  }

  // Authentification, limite et validation répondent AVANT d'ouvrir le flux, avec leur vrai code HTTP.
  let prepared: { userId: string; id: string; content: string; web?: boolean; documentIds?: string[] };
  try {
    const user = await requireUser();
    limit(`chat:${user.id}`, 20, 60_000);
    const { content, web, documentIds, regenerate } = messageSchema.parse(await readJson<unknown>(req));
    const id = (await ctx.params).id;
    prepared = { userId: user.id, id, content: regenerate ? await takeLastTurn(user.id, id) : content, web, documentIds };
  } catch (err) {
    return handle(async () => {
      throw err;
    });
  }

  // `after` doit être appelé dans la requête : les tâches sont collectées pendant le flux et lancées une fois celui-ci terminé.
  const tasks: (() => Promise<unknown>)[] = [];
  let finished!: () => void;
  const streamClosed = new Promise<void>((resolve) => (finished = resolve));
  after(async () => {
    await streamClosed;
    await Promise.allSettled(tasks.map((t) => t()));
  });

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };
      const turn = beginTurn(prepared.id, prepared.userId);
      try {
        // Si l'étudiant quitte la page, la réponse se termine quand même et reste dans la conversation ; seul « Arrêter » l'interrompt.
        const reply = await sendMessage(prepared.userId, prepared.id, prepared.content, { web: prepared.web, documentIds: prepared.documentIds, signal: turn.signal, emit: (e: ChatEvent) => send(e), defer: (t) => void tasks.push(t) });
        send({ type: "done", ...reply });
      } catch (err) {
        const status = err instanceof ApiHttpError ? err.status : 500;
        if (!(err instanceof ApiHttpError)) console.error("[chat stream]", err);
        send({ type: "error", error: err instanceof ApiHttpError ? err.message : "Une erreur interne est survenue.", status });
      } finally {
        turn.end();
        if (!closed) {
          closed = true;
          controller.close();
        }
        finished();
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" } });
}
