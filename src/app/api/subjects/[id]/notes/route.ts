import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { createNote, linkInputSchema, listNotes } from "@/server/services/notes";

const listSchema = z.object({
  kind: z.enum(["PERSONAL", "DOCUMENT", "ANNOTATION", "SUMMARY"]).optional(),
  documentId: z.string().min(1).optional(),
  q: z.string().max(200).optional(),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const f = listSchema.parse({
      kind: sp.get("kind") || undefined,
      documentId: sp.get("documentId") || undefined,
      q: sp.get("q") || undefined,
    });
    return { notes: await listNotes(user.id, { subjectId: id, ...f }) };
  });
}

const createSchema = z.object({
  kind: z.enum(["PERSONAL", "SUMMARY"]).optional(),
  title: z.string().max(200).optional(),
  content: z.unknown().optional(),
  links: z.array(linkInputSchema).max(20).optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    limit(`notes:${user.id}`, 120, 60_000);
    const { id } = await ctx.params;
    const data = createSchema.parse(await readJson<unknown>(req));
    return { note: await createNote(user.id, { subjectId: id, ...data }) };
  });
}
