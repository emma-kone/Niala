import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, limit } from "@/lib/api-helpers";
import { listImports, startImport } from "@/server/services/agenda/import";

// La lecture d'un document par le modèle peut durer plus d'une minute.
export const maxDuration = 120;

export async function GET() {
  return handle(async () => listImports((await requireUser()).id));
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`agenda-import:${user.id}`, 10, 60_000);
    const form = await req.formData().catch(() => {
      throw new ApiHttpError("Formulaire invalide.", 400);
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiHttpError("Aucun fichier reçu.", 422);
    return startImport(user.id, file);
  });
}
