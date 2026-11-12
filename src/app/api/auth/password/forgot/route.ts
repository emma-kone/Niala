import { clientIp, handle, limitDurable, readJson } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { requestPasswordReset } from "@/server/services/password-reset";

/** « Mot de passe oublié » : réponse identique que l'adresse corresponde à un compte ou non. */
export async function POST(req: Request) {
  return handle(async () => {
    await limitDurable(`password-forgot:${clientIp(req)}`, 5, 15 * 60_000);
    return requestPasswordReset(await readJson<unknown>(req), appOrigin(req));
  });
}
