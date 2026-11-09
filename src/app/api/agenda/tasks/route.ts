import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { clockSchema, createTask, createTaskSchema, listTasks } from "@/server/services/agenda/tasks";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    return { tasks: await listTasks(user.id, clockSchema.parse({ date: q.get("date"), minutes: q.get("minutes") })) };
  });
}

export async function POST(req: Request) {
  return handle(async () => ({ task: await createTask((await requireUser()).id, createTaskSchema.parse(await readJson<unknown>(req))) }));
}
