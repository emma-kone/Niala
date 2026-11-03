import { requireUser } from "@/lib/auth";
import { handle, limit, readJson, ApiHttpError } from "@/lib/api-helpers";
import { saveAnswer } from "@/server/services/exercises/attempts";

/** Enregistrement d'une réponse (reprise garantie en cas d'interruption). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; position: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`answers:${user.id}`, 600, 60_000);
    const { id, position } = await ctx.params;
    const n = Number(position);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw new ApiHttpError("Question invalide.", 422);
    const body = await readJson<{ value?: unknown }>(req);
    return saveAnswer(user.id, id, n, body.value ?? null);
  });
}
