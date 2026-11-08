import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listRange } from "@/server/services/agenda/agenda";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const q = new URL(req.url).searchParams;
    return listRange(user.id, q.get("from") ?? "", q.get("to") ?? "");
  });
}
