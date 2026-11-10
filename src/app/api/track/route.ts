import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { CLIENT_TYPES, isModule } from "@/server/analytics/definitions";
import { recordEvent } from "@/server/analytics/track";

const schema = z.object({
  type: z.enum(CLIENT_TYPES as unknown as [string, ...string[]]),
  module: z.string().max(30).optional(),
  durationMs: z.number().int().min(0).max(120_000).optional(),
});

/**
 * Balise d'usage envoyée par le navigateur : ouverture de module, consultation d'un cours, durée de chargement d'une page.
 * Seuls quelques types sont acceptés ; aucun contenu, aucune URL complète n'est transmis ni conservé.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await getCurrentUser();
    if (!user) return { ok: false };
    limit(`track:${user.id}`, 120, 60_000);
    const body = schema.parse(await readJson<unknown>(req));
    await recordEvent(user.id, body.type as (typeof CLIENT_TYPES)[number], { module: isModule(body.module) ? body.module : undefined, durationMs: body.durationMs });
    return { ok: true };
  });
}
