import { clientIp, handle, limit, readJson } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { submitGuestRequest } from "@/server/admin/support";

/** Assistance sans compte, depuis la page de connexion : la demande arrive à l'équipe, les réponses partent par e-mail. */
export async function POST(req: Request) {
  return handle(async () => {
    limit(`assistance:${clientIp(req)}`, 5, 60 * 60_000);
    return submitGuestRequest(await readJson<unknown>(req), appOrigin(req));
  });
}
