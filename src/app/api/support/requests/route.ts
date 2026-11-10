import { requireUser } from "@/lib/auth";
import { ApiHttpError, handle, limit } from "@/lib/api-helpers";
import { listMyRequests, submitRequest, type UploadedFile } from "@/server/admin/support";

export async function GET() {
  return handle(async () => ({ requests: await listMyRequests((await requireUser()).id) }));
}

/** Dépôt d'une demande (formulaire multipart : champs texte + fichiers facultatifs). L'e-mail vient du compte. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    limit(`support:${user.id}`, 8, 60 * 60_000);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ApiHttpError("Formulaire invalide.", 400);
    }
    const text = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
    const files: UploadedFile[] = [];
    for (const f of form.getAll("files")) {
      if (typeof f === "string" || f.size === 0) continue;
      files.push({ name: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) });
    }
    return submitRequest(user.id, { type: text("type"), subject: text("subject"), description: text("description"), module: text("module"), urgency: text("urgency") || undefined }, files);
  });
}
