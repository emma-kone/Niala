import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { learningProfile } from "@/server/services/progress/profile";

/** Profil pédagogique : notions fragiles, à revérifier, difficultés récurrentes, derniers diagnostics. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const subjectId = new URL(req.url).searchParams.get("subjectId") || undefined;
    return { profile: await learningProfile(user.id, subjectId) };
  });
}
