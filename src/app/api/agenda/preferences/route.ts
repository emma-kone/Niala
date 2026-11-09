import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { getPrefs, prefsSchema, savePrefs } from "@/server/services/agenda/tasks";

export async function GET() {
  return handle(async () => ({ preferences: await getPrefs((await requireUser()).id) }));
}

export async function PUT(req: Request) {
  return handle(async () => ({ preferences: await savePrefs((await requireUser()).id, prefsSchema.parse(await readJson<unknown>(req))) }));
}
