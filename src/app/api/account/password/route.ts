import { requireUser, setSessionCookie } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { changePassword, passwordChangeSchema } from "@/server/services/profile";

/** Après le changement, les autres sessions sont fermées ; celle-ci reste ouverte avec un nouveau jeton. */
export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`account-password:${user.id}`, 5, 60_000);
    const result = await changePassword(user.id, passwordChangeSchema.parse(await readJson<unknown>(req)));
    await setSessionCookie(user.id);
    return result;
  });
}
