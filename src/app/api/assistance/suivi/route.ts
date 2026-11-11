import { z } from "zod";
import { clientIp, handle, limit, readJson } from "@/lib/api-helpers";
import { getGuestThread, replyAsGuest } from "@/server/admin/support";

// Le jeton du lien de suivi voyage dans le corps de la requête (jamais dans l'adresse : il n'apparaît dans aucun journal).
const schema = z.object({ token: z.string().min(20).max(120), body: z.string().max(4000).optional() });

/** Suivi d'une demande de visiteur sans compte : `{ token }` lit l'échange, `{ token, body }` y répond. */
export async function POST(req: Request) {
  return handle(async () => {
    const { token, body } = schema.parse(await readJson<unknown>(req));
    if (body === undefined) {
      limit(`assistance-read:${clientIp(req)}`, 60, 60_000);
      return getGuestThread(token);
    }
    limit(`assistance-reply:${clientIp(req)}`, 10, 10 * 60_000);
    await replyAsGuest(token, body);
    return getGuestThread(token);
  });
}
