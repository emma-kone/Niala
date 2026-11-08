import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { createEvent, createEventSchema } from "@/server/services/agenda/agenda";

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    return { event: await createEvent(user.id, createEventSchema.parse(await readJson<unknown>(req))) };
  });
}
