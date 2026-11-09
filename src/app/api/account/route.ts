import { clearSessionCookie, requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { deleteAccount, deleteAccountSchema } from "@/server/services/profile";

/** Suppression définitive du compte, confirmée par le mot de passe (ou l'adresse pour un compte Google). */
export async function DELETE(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`account-delete:${user.id}`, 5, 60_000);
    const result = await deleteAccount(user.id, deleteAccountSchema.parse(await readJson<unknown>(req)));
    await clearSessionCookie();
    return result;
  });
}
