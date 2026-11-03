import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { progress } from "@/server/services/progress/progress";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    return progress(user.id, new URL(req.url).searchParams.get("subjectId") || undefined);
  });
}
