import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listRecommendations } from "@/server/services/progress/progress";

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    return { recommendations: await listRecommendations(user.id, new URL(req.url).searchParams.get("subjectId") || undefined) };
  });
}
