import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { createFolder, moveItems } from "@/server/services/folders";

const createSchema = z.object({
  subjectId: z.string().min(1),
  parentId: z.string().min(1).nullable().default(null),
  name: z.string().min(1).max(200),
});

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const data = createSchema.parse(await readJson<unknown>(req));
    return { folder: await createFolder(user.id, data) };
  });
}

const moveSchema = z.object({
  subjectId: z.string().min(1),
  folderIds: z.array(z.string().min(1)).max(200).default([]),
  documentIds: z.array(z.string().min(1)).max(200).default([]),
  targetFolderId: z.string().min(1).nullable(),
});

/** Déplacement groupé de dossiers et de documents (même matière). */
export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const data = moveSchema.parse(await readJson<unknown>(req));
    if (data.folderIds.length + data.documentIds.length === 0) return { moved: 0 };
    return moveItems(user.id, data);
  });
}
