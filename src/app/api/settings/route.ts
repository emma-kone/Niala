import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { USER_SETTINGS_SELECT } from "@/server/services/session";

// Seules les préférences de l'étudiant sont exposées : ni le modèle d'IA, ni la durée de conservation, ni les identifiants internes.
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const settings = (await db.userSettings.findUnique({ where: { userId: user.id }, select: USER_SETTINGS_SELECT })) ?? (await db.userSettings.create({ data: { userId: user.id }, select: USER_SETTINGS_SELECT }));
    return { settings };
  });
}

const patchSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  defaultMode: z.enum(["apprentissage", "entrainement", "examen", "revision", "personnalise"]).optional(),
  maxUploadMB: z.number().int().min(1).max(50).optional(),
  hintsEnabled: z.boolean().optional(),
  exerciseLang: z.enum(["fr", "en"]).optional(),
  textSize: z.enum(["normal", "large"]).optional(),
  correctionPref: z.enum(["immediate", "final"]).optional(),
  explanationLevel: z.enum(["simple", "standard", "detailed"]).optional(),
  notifyProgress: z.boolean().optional(),
  notifyRevision: z.boolean().optional(),
  notifyActivities: z.boolean().optional(),
});

export async function PUT(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const data = patchSchema.parse(await readJson<unknown>(req));
    const settings = await db.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data,
      select: USER_SETTINGS_SELECT,
    });
    return { settings };
  });
}
