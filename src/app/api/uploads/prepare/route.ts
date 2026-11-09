import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { prepareUploads } from "@/server/services/documents";

const schema = z.object({
  // null : cours ou sujet importé directement depuis le module Exercices, sans matière enregistrée.
  subjectId: z.string().min(1).nullable(),
  folderId: z.string().min(1).nullable().default(null),
  files: z.array(z.object({ name: z.string().min(1).max(300), size: z.number().int().positive() })).min(1).max(50),
});

/** Étape 1 de l'import : valide les fichiers annoncés et renvoie où les déposer. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`upload:${user.id}`, 20, 60_000);
    const data = schema.parse(await readJson<unknown>(req));
    return { results: await prepareUploads(user.id, data) };
  });
}
