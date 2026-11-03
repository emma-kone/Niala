import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, limit, readJson } from "@/lib/api-helpers";
import { createFree, createFromDocument, createFromQuestion, listWorkspaces } from "@/server/services/labs/labs";

export const maxDuration = 180;

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    const kind = sp.get("kind");
    const mode = sp.get("mode");
    if (kind && kind !== "CODE" && kind !== "SQL") throw new ApiHttpError("Type invalide.", 422);
    if (mode && mode !== "FREE" && mode !== "EXERCISE") throw new ApiHttpError("Mode invalide.", 422);
    return { workspaces: await listWorkspaces(user.id, { kind: (kind as "CODE" | "SQL" | null) ?? undefined, mode: (mode as "FREE" | "EXERCISE" | null) ?? undefined, subjectId: sp.get("subjectId") || undefined }) };
  });
}

const bodySchema = z.object({ from: z.enum(["free", "question", "document"]) }).passthrough();

/** Crée un espace de travail : libre, depuis une question d'exercice, ou depuis un document d'énoncés (IA). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`lab-create:${user.id}`, 20, 10 * 60_000);
    const { from, ...rest } = bodySchema.parse(await readJson<unknown>(req));
    if (from === "free") return { workspace: await createFree(user.id, rest) };
    if (from === "question") return { workspace: await createFromQuestion(user.id, rest) };
    limit(`lab-import:${user.id}`, 6, 10 * 60_000);
    return createFromDocument(user.id, rest);
  });
}
