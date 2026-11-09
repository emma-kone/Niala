import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { createEmptyMap, listAllMaps } from "@/server/services/maps";

/** Cartes de l'étudiant ; `?documentId=` pour celles d'un cours. */
export async function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const documentId = new URL(req.url).searchParams.get("documentId") || undefined;
    return { maps: await listAllMaps(user.id, { documentId }) };
  });
}

const schema = z.object({ title: z.string().trim().max(160).default("Nouvelle carte"), subjectId: z.string().min(1).nullable().default(null) });

/** Carte vide, à construire à la main, avec ou sans matière. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { title, subjectId } = schema.parse(await readJson<unknown>(req));
    return createEmptyMap(user.id, subjectId, title, "STRUCTURE");
  });
}
