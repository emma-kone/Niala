import { cookies } from "next/headers";
import { handle, limitDurable } from "@/lib/api-helpers";
import { ADMIN_INTENT_COOKIE, requestMeta } from "@/server/admin/session";

/**
 * Avant de partir chez Google depuis l'écran d'administration : mémorise l'intention (cookie court, httpOnly) afin que le
 * retour sur /auth/callback ouvre une session d'administration — sans jamais créer de compte — au lieu d'une session étudiante.
 */
export async function POST() {
  return handle(async () => {
    const meta = await requestMeta();
    await limitDurable(`admin-google-intent:${meta.ip ?? "?"}`, 20, 10 * 60_000);
    (await cookies()).set(ADMIN_INTENT_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
    return { ok: true };
  });
}
