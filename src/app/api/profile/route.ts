import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { getProfile, profileUpdateSchema, updateProfile } from "@/server/services/profile";

export async function GET() {
  return handle(async () => ({ profile: await getProfile((await requireUser()).id) }));
}

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    return { profile: await updateProfile(user.id, profileUpdateSchema.parse(await readJson<unknown>(req))) };
  });
}
