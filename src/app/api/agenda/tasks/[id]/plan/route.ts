import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { acceptPlan, acceptPlanSchema, clockSchema, proposePlan } from "@/server/services/agenda/tasks";

/** Propose une répartition : rien n'est enregistré. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    return proposePlan((await requireUser()).id, (await ctx.params).id, clockSchema.parse({ date: q.get("date"), minutes: q.get("minutes") }));
  });
}

/** Enregistre les séances retenues par l'étudiant. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => acceptPlan((await requireUser()).id, (await ctx.params).id, acceptPlanSchema.parse(await readJson<unknown>(req))));
}
