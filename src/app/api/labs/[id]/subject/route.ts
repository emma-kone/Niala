import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, limit } from "@/lib/api-helpers";
import { importDiagramSubjectFiles, MAX_SUBJECT_FILES } from "@/server/services/labs/diagrams";
import { getWorkspace } from "@/server/services/labs/labs";

export const maxDuration = 120;

/**
 * Sujet d'un exercice de diagramme importé depuis un ou plusieurs fichiers (PDF ou images, champ « file » répété).
 * Le texte extrait ou transcrit s'ajoute au sujet existant et reste modifiable ensuite.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`lab-subject:${user.id}`, 20, 10 * 60_000);
    const id = (await ctx.params).id;
    const form = await req.formData().catch(() => null);
    const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File);
    if (!files.length) throw new ApiHttpError("Ajoutez un fichier PDF ou une image.", 422);
    if (files.length > MAX_SUBJECT_FILES) throw new ApiHttpError(`${MAX_SUBJECT_FILES} fichiers au maximum par import.`, 422);
    await importDiagramSubjectFiles(user.id, id, await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    return { workspace: await getWorkspace(user.id, id) };
  });
}
