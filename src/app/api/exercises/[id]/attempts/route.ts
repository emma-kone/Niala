import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { startAttempt } from "@/server/services/exercises/attempts";

const schema = z.object({ fresh: z.boolean().optional() });

/** Démarre (ou reprend) une tentative : l'exercice est copié tel qu'il est à cet instant. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const body = req.headers.get("content-length") === "0" ? {} : await readJson<unknown>(req).catch(() => ({}));
    return startAttempt(user.id, id, schema.parse(body ?? {}));
  });
}
