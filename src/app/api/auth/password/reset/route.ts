import { clientIp, handle, limit, readJson } from "@/lib/api-helpers";
import { resetPassword } from "@/server/services/password-reset";

/** Choix d'un nouveau mot de passe à partir d'un lien de réinitialisation (usage unique). */
export async function POST(req: Request) {
  return handle(async () => {
    limit(`password-reset:${clientIp(req)}`, 10, 15 * 60_000);
    return resetPassword(await readJson<unknown>(req));
  });
}
