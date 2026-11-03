import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { generateExercise } from "@/server/services/exercises/generation";
import { listExercises } from "@/server/services/exercises/attempts";

export const maxDuration = 300;

export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    return { exercises: await listExercises(user.id, { subjectId: sp.get("subjectId") || undefined, documentId: sp.get("documentId") || undefined }) };
  });
}

/** Génère un exercice à partir d'UN document (la configuration est validée côté serveur). */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`exercise-generate:${user.id}`, 10, 10 * 60_000);
    return generateExercise(user.id, await readJson<unknown>(req));
  });
}
