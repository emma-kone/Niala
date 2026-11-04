import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { getReport } from "@/server/diagnosis/tutor";

/** Diagnostic d'une tentative, avec interprétation, aides données et questions de vérification. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    return { report: await getReport(user.id, (await ctx.params).id) };
  });
}
