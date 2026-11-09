import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { importExercises } from "@/server/services/exercises/import";

export const maxDuration = 300;

/** Reproduit les exercices d'un document déjà importé sous une forme interactive. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`exercise-import:${user.id}`, 10, 10 * 60_000);
    return importExercises(user.id, await readJson<unknown>(req));
  });
}
