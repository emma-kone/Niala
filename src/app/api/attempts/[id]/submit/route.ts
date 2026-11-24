import { requireUser } from "@/lib/auth";
import { z } from "zod";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { submitAttempt } from "@/server/services/exercises/attempts";

export const maxDuration = 300;

const bodySchema = z.object({ durationSec: z.number().int().min(1).max(86_400 * 7).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`submit:${user.id}`, 30, 10 * 60_000);
    const { id } = await ctx.params;
    // Corps facultatif : le temps passé relevé par le chronomètre.
    const body = req.headers.get("content-length") && req.headers.get("content-length") !== "0" ? bodySchema.safeParse(await readJson<unknown>(req).catch(() => ({}))) : null;
    return { attempt: await submitAttempt(user.id, id, body?.success ? body.data.durationSec : undefined) };
  });
}
