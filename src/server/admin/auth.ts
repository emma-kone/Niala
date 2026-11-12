import { ApiHttpError } from "@/lib/api-helpers";
import { checkPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import { isAdminRole, landingFor, type AdminRole } from "@/server/admin/rbac";
import type { GoogleProfile } from "@/server/services/accounts";

// Connexion à l'espace d'administration. Les messages d'échec sont volontairement identiques pour « compte inconnu »,
// « mauvais mot de passe » et « pas administrateur » : on ne révèle pas quelles adresses ont un accès.

const GENERIC = "Identifiants incorrects ou accès non autorisé.";

export interface AdminLoginResult {
  userId: string;
  version: number;
  role: AdminRole;
  landing: string;
}

export async function loginAdminWithPassword(emailRaw: string, password: string, meta: { ip: string | null }): Promise<AdminLoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  // Le hachage est calculé même pour une adresse inconnue : le temps de réponse ne révèle pas quelles adresses ont un compte.
  const passwordOk = checkPassword(password, user?.passwordHash) && !!user;
  if (!user || !passwordOk || !isAdminRole(user.adminRole) || user.accountStatus !== "ACTIVE") {
    await audit({ id: user?.id ?? null, email }, "admin.login_failed", { targetType: "admin", result: "FAILED", detail: { reason: !user || !passwordOk ? "credentials" : "not_authorized", ip: meta.ip } });
    throw new ApiHttpError(GENERIC, 401);
  }
  await audit({ id: user.id, email: user.email }, "admin.login", { targetType: "admin", targetId: user.id, detail: { method: "password", role: user.adminRole, ip: meta.ip } });
  return { userId: user.id, version: user.sessionVersion, role: user.adminRole, landing: landingFor(user.adminRole) };
}

/**
 * Connexion administrateur par Google : ne crée JAMAIS de compte. Le compte doit déjà exister, être lié à cette
 * identité Google (ou avoir été créé par Google avec cette adresse) et porter un rôle d'administration.
 */
export async function loginAdminWithGoogle(profile: GoogleProfile, meta: { ip: string | null }): Promise<AdminLoginResult> {
  const fail = async (reason: string, id: string | null = null): Promise<never> => {
    await audit({ id, email: profile.email.toLowerCase() }, "admin.login_failed", { targetType: "admin", result: "FAILED", detail: { reason, method: "google", ip: meta.ip } });
    throw new ApiHttpError(GENERIC, 401);
  };
  if (!profile.emailVerified) return fail("unverified");
  const email = profile.email.trim().toLowerCase();
  const user = (await db.user.findUnique({ where: { googleSub: profile.sub } })) ?? (await db.user.findUnique({ where: { email } }));
  if (!user) return fail("unknown");
  // Un compte à mot de passe non lié à Google ne s'ouvre pas par Google : la liaison se confirme avec le mot de passe, côté plateforme.
  const linked = user.googleSub === profile.sub || user.passwordHash === `oauth:google:${profile.sub}`;
  if (!linked) return fail("not_linked", user.id);
  if (!isAdminRole(user.adminRole) || user.accountStatus !== "ACTIVE") return fail("not_authorized", user.id);
  if (!user.googleSub) await db.user.update({ where: { id: user.id }, data: { googleSub: profile.sub } });
  await audit({ id: user.id, email: user.email }, "admin.login", { targetType: "admin", targetId: user.id, detail: { method: "google", role: user.adminRole, ip: meta.ip } });
  return { userId: user.id, version: user.sessionVersion, role: user.adminRole, landing: landingFor(user.adminRole) };
}
