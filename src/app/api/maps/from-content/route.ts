import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { generateMindMapFromContent } from "@/server/services/maps-ai";

export const maxDuration = 300;

/** Génère une carte mentale éditable par l'IA, depuis un cours ou un texte fourni. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`mindmap-generate:${user.id}`, 10, 10 * 60_000);
    return generateMindMapFromContent(user.id, await readJson<unknown>(req));
  });
}
