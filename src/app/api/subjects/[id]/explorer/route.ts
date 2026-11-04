import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { explorer } from "@/server/services/documents";

const querySchema = z.object({
  folderId: z.string().min(1).nullable(),
  q: z.string().max(200).optional(),
  content: z.enum(["0", "1"]).optional(),
  kind: z.enum(["pdf", "docx", "pptx", "txt", "md"]).optional(),
  status: z.enum(["PENDING", "PROCESSING", "READY", "PARTIAL", "FAILED", "UNSUPPORTED"]).optional(),
  sort: z.enum(["name", "date", "size", "type"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

/** Contenu d'une matière : dossiers + documents d'un dossier, ou résultats de recherche dans toute la matière. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const parsed = querySchema.parse({
      folderId: sp.get("folderId") || null,
      q: sp.get("q") || undefined,
      content: sp.get("content") || undefined,
      kind: sp.get("kind") || undefined,
      status: sp.get("status") || undefined,
      sort: sp.get("sort") || undefined,
      dir: sp.get("dir") || undefined,
    });
    return explorer(user.id, {
      subjectId: id,
      folderId: parsed.folderId,
      q: parsed.q,
      inContent: parsed.content === "1",
      kind: parsed.kind,
      status: parsed.status,
      sort: parsed.sort,
      dir: parsed.dir,
    });
  });
}
