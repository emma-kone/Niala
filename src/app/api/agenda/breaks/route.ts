import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { breakSchema, createBreak, listBreaks } from "@/server/services/agenda/tasks";

export async function GET() {
  return handle(async () => ({ breaks: await listBreaks((await requireUser()).id) }));
}

export async function POST(req: Request) {
  return handle(async () => ({ break: await createBreak((await requireUser()).id, breakSchema.parse(await readJson<unknown>(req))) }));
}
