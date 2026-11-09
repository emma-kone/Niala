import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { ownedAttempt } from "@/server/services/exercises/attempts";
import { listRevisions, recordRevision } from "@/server/services/workspaces/revisions";

const position = (v: string) => z.coerce.number().int().min(1).parse(v);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; position: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id, position: p } = await ctx.params;
    await ownedAttempt(user.id, id);
    return { revisions: await listRevisions(user.id, id, position(p)) };
  });
}

/** Crée un point de restauration de la production en cours. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; position: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`workspace-revision:${user.id}`, 30, 60_000);
    const { id, position: p } = await ctx.params;
    const attempt = await ownedAttempt(user.id, id);
    const answer = attempt.answers.find((a) => a.position === position(p));
    if (!answer) return { number: null };
    return { number: await recordRevision(user.id, id, position(p), answer.value, { force: true }) };
  });
}
