import { z } from "zod";
import { NextResponse } from "next/server";
import { clearLinkCookie, getPendingLink, setSessionCookie } from "@/lib/auth";
import { ApiHttpError, handle, jsonError, limitDurable, readJson } from "@/lib/api-helpers";
import { LinkError, linkGoogleAccount } from "@/server/services/accounts";

const linkSchema = z.object({ password: z.string().min(1, "Mot de passe requis").max(200) });

/** Confirme le mot de passe Niala, lie l'identité Google en attente au compte et ouvre la session. */
export async function POST(req: Request) {
  return handle(async () => {
    const pending = await getPendingLink();
    if (!pending) return jsonError("La demande a expiré : reprenez la connexion avec Google.", 410);
    // Limite par adresse contre les essais de mots de passe.
    await limitDurable(`google-link:${pending.email.toLowerCase()}`, 5, 10 * 60_000);
    const { password } = linkSchema.parse(await readJson<unknown>(req));
    try {
      const user = await linkGoogleAccount(pending, password);
      await clearLinkCookie();
      await setSessionCookie(user.id);
      return NextResponse.json({ ok: true, user });
    } catch (e) {
      if (e instanceof LinkError) {
        if (e.reason === "invalid_password") throw new ApiHttpError("Mot de passe incorrect.", 401);
        await clearLinkCookie();
        throw new ApiHttpError("Ce compte ne peut pas être lié à Google.", 409);
      }
      throw e;
    }
  });
}

/** Abandon de la liaison : le profil Google en attente est oublié. */
export async function DELETE() {
  return handle(async () => {
    await clearLinkCookie();
    return { ok: true };
  });
}
