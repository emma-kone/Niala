import { timingSafeEqual } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApiHttpError } from "@/lib/api-helpers";
import { AuthError, hmacFor } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import { ADMIN_BASE, can, isAdminRole, permissionsOf, type AdminRole, type Permission } from "@/server/admin/rbac";

// ─────────────────────────────────────────────────────────────────────────────
// Session d'administration. Même type d'authentification que la plateforme (e-mail + mot de passe haché scrypt, ou
// Google via Supabase), mais SESSION DISTINCTE : cookie propre, durée plus courte, jeton signé avec un autre domaine
// de séparation. Une session étudiante ne donne jamais accès au back-office, et inversement.
// Le rôle, le statut du compte et la version de session sont relus en base à CHAQUE requête.
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_COOKIE = "niala_admin";
export const ADMIN_INTENT_COOKIE = "niala_admin_intent";
export const ADMIN_SESSION_TTL_MS = 8 * 3600 * 1000;
export const adminLoginPath = `${ADMIN_BASE}/login`;

const sign = (payload: string) => hmacFor("admin-session", payload);

export function createAdminToken(userId: string, version: number, now = Date.now()): string {
  const payload = `${userId}.${now + ADMIN_SESSION_TTL_MS}.${version}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token: string, now = Date.now()): { userId: string; version: number } | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [userId, exp, version, sig] = parts;
  const expected = Buffer.from(sign(`${userId}.${exp}.${version}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!(Number(exp) > now)) return null;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 0) return null;
  return { userId, version: v };
}

export async function setAdminCookie(userId: string, version: number) {
  (await cookies()).set(ADMIN_COOKIE, createAdminToken(userId, version), {
    httpOnly: true,
    sameSite: "lax", // « strict » priverait de cookie la redirection qui suit le retour de Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_MS / 1000,
  });
}

export async function clearAdminCookie() {
  (await cookies()).set(ADMIN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  permissions: readonly Permission[];
}

/** Administrateur de la session courante, ou null (pas de session, jeton expiré, rôle retiré, compte suspendu). */
async function readAdmin(): Promise<AdminUser | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const session = verifyAdminToken(token);
  if (!session) return null;
  try {
    const user = await db.user.findUnique({ where: { id: session.userId }, select: { id: true, email: true, name: true, adminRole: true, accountStatus: true, sessionVersion: true } });
    if (!user || user.sessionVersion !== session.version || user.accountStatus !== "ACTIVE" || !isAdminRole(user.adminRole)) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.adminRole, permissions: permissionsOf(user.adminRole) };
  } catch {
    return null;
  }
}

/**
 * Le layout, la page et leurs sous-composants demandent tous l'administrateur : une seule lecture en base par requête
 * (le rôle, le statut et la version de session restent relus à CHAQUE requête, jamais gardés d'une requête à l'autre).
 */
export const getAdmin = cache(readAdmin);

export class ForbiddenError extends ApiHttpError {
  constructor(message = "Vous n'avez pas l'autorisation d'effectuer cette action.") {
    super(message, 403);
  }
}

export async function requestMeta() {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || null;
    return { ip, userAgent: h.get("user-agent")?.slice(0, 160) ?? null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/** Garde d'API : 401 sans session d'administration, 403 (et trace d'audit) sans la permission demandée. */
export async function requireAdmin(permission: Permission | Permission[]): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) throw new AuthError();
  const needed = Array.isArray(permission) ? permission : [permission];
  if (!needed.some((p) => can(admin.role, p))) {
    await audit(admin, "access.denied", { targetType: "permission", targetId: needed.join(","), result: "DENIED" });
    throw new ForbiddenError();
  }
  return admin;
}

/** Garde de page : redirige vers la connexion d'administration, ou vers une page « accès refusé ». */
export async function requireAdminPage(permission: Permission | Permission[]): Promise<AdminUser> {
  const admin = await getAdmin();
  if (!admin) redirect(adminLoginPath);
  const needed = Array.isArray(permission) ? permission : [permission];
  if (!needed.some((p) => can(admin.role, p))) {
    await audit(admin, "access.denied", { targetType: "page", targetId: needed.join(","), result: "DENIED" });
    redirect(`${ADMIN_BASE}/acces-refuse`);
  }
  return admin;
}
