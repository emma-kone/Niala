import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, limit, readJson } from "@/lib/api-helpers";
import { askLabAssistant, assistantSchema, type AssistantEvent } from "@/server/services/labs/assistant";

export const maxDuration = 120;

/** Assistant IA des laboratoires. Réponse en flux de lignes JSON : {type:"delta"}… puis {type:"done"} ou {type:"error"}. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let prepared: { userId: string; id: string; input: ReturnType<typeof assistantSchema.parse> };
  // Authentification, limite et validation répondent avant d'ouvrir le flux, avec leur vrai code HTTP.
  try {
    const user = await requireUser();
    limit(`lab-assistant:${user.id}`, 20, 60_000);
    prepared = { userId: user.id, id: (await ctx.params).id, input: assistantSchema.parse(await readJson<unknown>(req)) };
  } catch (err) {
    return handle(async () => {
      throw err;
    });
  }

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
      try {
        send({ type: "done", ...(await askLabAssistant(prepared.userId, prepared.id, prepared.input, (e: AssistantEvent) => send(e))) });
      } catch (err) {
        if (!(err instanceof ApiHttpError)) console.error("[lab assistant]", err);
        send({ type: "error", error: err instanceof ApiHttpError ? err.message : "Une erreur interne est survenue.", status: err instanceof ApiHttpError ? err.status : 500 });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform" } });
}
