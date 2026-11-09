import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { askTutor, tutorRequestSchema, tutorState } from "@/server/services/exercises/tutor";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const position = z.coerce.number().int().min(1).parse(new URL(req.url).searchParams.get("position"));
    return tutorState(user.id, id, position);
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    limit(`tutor:${user.id}`, 30, 60_000);
    return askTutor(user.id, id, tutorRequestSchema.parse(await readJson<unknown>(req)));
  });
}
