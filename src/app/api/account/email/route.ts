import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { changeEmail, emailChangeSchema } from "@/server/services/profile";

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`account-email:${user.id}`, 5, 60_000);
    return changeEmail(user.id, emailChangeSchema.parse(await readJson<unknown>(req)));
  });
}
