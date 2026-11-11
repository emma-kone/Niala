import { ApiHttpError, handle, limit, readJson } from "@/lib/api-helpers";
import { assistantInputSchema, runAssistant, type AssistantEvent } from "@/server/admin/assistant/assistant";
import { PERMISSIONS } from "@/server/admin/rbac";
import { requireAdmin } from "@/server/admin/session";

// Un message peut enchaîner plusieurs lectures et appels au modèle.
export const maxDuration = 120;

/**
 * Assistant IA du back-office (tout administrateur ; les outils sont filtrés par rôle côté serveur).
 * Avec `Accept: application/x-ndjson` : flux de lignes JSON ({type:"status"|"delta"|"proposal"}… puis "done" ou "error").
 * Sans : réponse JSON classique.
 */
export async function POST(req: Request) {
  const streaming = (req.headers.get("accept") ?? "").includes("application/x-ndjson");

  // Authentification, limite et validation répondent AVANT d'ouvrir le flux, avec leur vrai code HTTP.
  let prepared: { admin: Awaited<ReturnType<typeof requireAdmin>>; body: unknown };
  try {
    const admin = await requireAdmin([...PERMISSIONS]);
    limit(`admin-assistant:${admin.id}`, 15, 60_000);
    const body = await readJson<unknown>(req);
    assistantInputSchema.parse(body);
    prepared = { admin, body };
  } catch (err) {
    return handle(async () => {
      throw err;
    });
  }

  if (!streaming) return handle(() => runAssistant(prepared.admin, prepared.body, { signal: req.signal }));

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
        const reply = await runAssistant(prepared.admin, prepared.body, { signal: req.signal, emit: (e: AssistantEvent) => send(e) });
        send({ type: "done", ...reply });
      } catch (err) {
        const status = err instanceof ApiHttpError ? err.status : 500;
        if (!(err instanceof ApiHttpError)) console.error("[admin-assistant stream]", err);
        send({ type: "error", error: err instanceof ApiHttpError ? err.message : "Une erreur interne est survenue.", status });
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
