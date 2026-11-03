import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { generateConceptMap, generateStructureMap } from "@/server/services/maps";

const schema = z.object({ analysisId: z.string().min(1), kind: z.enum(["STRUCTURE", "CONCEPT"]) });

/** Génère une carte éditable à partir d'une analyse de document. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`maps-generate:${user.id}`, 20, 60_000);
    const { analysisId, kind } = schema.parse(await readJson<unknown>(req));
    return kind === "STRUCTURE" ? generateStructureMap(user.id, analysisId) : generateConceptMap(user.id, analysisId);
  });
}
