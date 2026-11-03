import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { getAnalysis, runAnalysis } from "@/server/services/analysis/analysis-service";

// L'analyse (structure + appels IA) peut durer plusieurs minutes sur un long cours.
export const maxDuration = 300;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const analysisId = new URL(req.url).searchParams.get("analysisId") || undefined;
    return getAnalysis(user.id, id, analysisId);
  });
}

const schema = z.object({ force: z.boolean().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`analysis:${user.id}`, 10, 10 * 60_000);
    const { id } = await ctx.params;
    const body = req.headers.get("content-length") === "0" ? {} : await readJson<unknown>(req).catch(() => ({}));
    const { force } = schema.parse(body ?? {});
    const result = await runAnalysis(user.id, id, { force });
    return { ...result, ...(await getAnalysis(user.id, id, result.analysisId)) };
  });
}
