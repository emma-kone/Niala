import { db } from "@/lib/db";

/** Préférences exposées au client : jamais le modèle d'IA ni la durée de conservation, qui restent internes. */
export const USER_SETTINGS_SELECT = {
  theme: true,
  textSize: true,
  exerciseLang: true,
  chatLang: true,
  defaultMode: true,
  hintsEnabled: true,
  correctionPref: true,
  explanationLevel: true,
  maxUploadMB: true,
  notifyProgress: true,
  notifyRevision: true,
  notifyActivities: true,
} as const;

/** Tout ce dont l'interface a besoin à l'ouverture, lu en une fois côté serveur pour éviter autant d'allers-retours du navigateur. */
export async function sessionBootstrap(user: { id: string; email: string; name: string | null }) {
  const [profile, settings] = await Promise.all([
    db.studentProfile.findUnique({ where: { userId: user.id }, select: { avatar: true, category: true } }),
    db.userSettings.findUnique({ where: { userId: user.id }, select: USER_SETTINGS_SELECT }),
  ]);
  return {
    user: { id: user.id, email: user.email, name: user.name, avatar: profile?.avatar ?? null, profileComplete: !!profile?.category },
    settings,
  };
}
export type SessionBootstrap = Awaited<ReturnType<typeof sessionBootstrap>>;
