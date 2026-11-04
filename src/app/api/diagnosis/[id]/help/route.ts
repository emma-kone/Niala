import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { help, type HelpLevel } from "@/server/diagnosis/tutor";

export const maxDuration = 120;

const schema = z.object({ level: z.number().int().min(1).max(6) });

/** Aide à 6 niveaux : indice, explication ciblée, décomposition, exemple, correction expliquée, vérification de compréhension. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`diag-ai:${user.id}`, 20, 60_000);
    const { level } = schema.parse(await readJson<unknown>(req));
    return { report: await help(user.id, (await ctx.params).id, level as HelpLevel) };
  });
}
