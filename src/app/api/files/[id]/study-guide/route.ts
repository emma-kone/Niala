import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { GRANULARITIES, generateGuide, listGuides } from "@/server/services/analysis/study-guide";

// Une fiche par partie demande plusieurs appels au modèle.
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    return listGuides(user.id, id, new URL(req.url).searchParams.get("analysisId") || undefined);
  });
}

const schema = z.object({
  granularity: z.enum(GRANULARITIES),
  sectionIds: z.array(z.string().min(1)).max(80).optional(),
  analysisId: z.string().min(1).optional(),
  force: z.boolean().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`study-guide:${user.id}`, 12, 10 * 60_000);
    const { id } = await ctx.params;
    const body = schema.parse(await readJson<unknown>(req));
    return { guide: await generateGuide(user.id, id, body) };
  });
}
