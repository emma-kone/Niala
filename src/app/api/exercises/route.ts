import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { generateExercise, generateFreeExercise } from "@/server/services/exercises/generation";
import { listExercises } from "@/server/services/exercises/attempts";

export const maxDuration = 300;

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    return { exercises: await listExercises(user.id, { subjectId: sp.get("subjectId") || undefined, documentId: sp.get("documentId") || undefined }) };
  });
}

/** Génère un exercice à partir de documents, ou librement à partir d'un thème (la configuration est validée côté serveur). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`exercise-generate:${user.id}`, 10, 10 * 60_000);
    const body = await readJson<{ source?: string }>(req);
    return body?.source === "free" ? generateFreeExercise(user.id, body) : generateExercise(user.id, body);
  });
}
