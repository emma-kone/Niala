import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { analyzeCode } from "@/server/services/labs/analyze";

export const maxDuration = 60;

const schema = z.object({ language: z.string().min(1).max(20), content: z.string().max(60_000), workspaceId: z.string().optional() });

/** Analyse en direct (jamais d'exécution du code) : syntaxe validée par les outils du langage, et « exécutable ici ou non ». */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`analyze:${user.id}`, 90, 60_000);
    const { language, content, workspaceId } = schema.parse(await readJson<unknown>(req));
    return { analysis: await analyzeCode(user.id, { language, content, workspaceId }) };
  });
}
