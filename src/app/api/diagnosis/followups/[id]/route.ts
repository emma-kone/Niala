import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { answerFollowup } from "@/server/diagnosis/tutor";

export const maxDuration = 120;

const schema = z.object({ answer: z.string().trim().min(1, "Réponse vide.").max(2000, "Réponse trop longue.") });

/** Réponse de l'étudiant à une question de vérification : elle enrichit le diagnostic. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`diag-ai:${user.id}`, 20, 60_000);
    const { answer } = schema.parse(await readJson<unknown>(req));
    return { report: await answerFollowup(user.id, (await ctx.params).id, answer) };
  });
}
