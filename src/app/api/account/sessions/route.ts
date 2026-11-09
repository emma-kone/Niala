import { requireUser, setSessionCookie } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { revokeSessions } from "@/server/services/profile";

/** Ferme la session sur tous les autres appareils ; l'appareil courant reste connecté. */
export async function DELETE() {
  return handle(async () => {
    const user = await requireUser();
    limit(`account-sessions:${user.id}`, 10, 60_000);
    const result = await revokeSessions(user.id);
    await setSessionCookie(user.id);
    return result;
  });
}
