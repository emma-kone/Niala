import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ApiHttpError } from "@/lib/api-helpers";
import { hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Création de comptes : e-mail et mot de passe, ou Google (authentifié par Supabase Auth).
// Un compte Google porte son identifiant Google à la place du mot de passe : aucune connexion par
// mot de passe n'est possible dessus (verifyPassword n'accepte que le format scrypt).
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_PASSWORD_LENGTH = 10;

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Indiquez votre nom.").max(80, "Nom trop long."),
  email: z.string().trim().email("Adresse e-mail invalide."),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`).max(200, "Mot de passe trop long."),
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const googleMarker = (sub: string) => `oauth:google:${sub}`;
const publicUser = (u: { id: string; email: string; name: string | null }) => ({ id: u.id, email: u.email, name: u.name });

export async function registerUser(input: z.infer<typeof registerSchema>) {
  const email = normalizeEmail(input.email);
  try {
    const user = await db.user.create({ data: { email, name: input.name.trim(), passwordHash: hashPassword(input.password), settings: { create: {} } } });
    return publicUser(user);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiHttpError("Un compte existe déjà avec cette adresse e-mail.", 409);
    throw e;
  }
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

/** Forme minimale de l'utilisateur renvoyé par Supabase Auth. */
export interface SupabaseAuthUser {
  email?: string;
  user_metadata?: Record<string, unknown>;
  identities?: { provider: string; identity_data?: Record<string, unknown> }[];
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Profil Google d'un utilisateur Supabase ; null s'il ne s'est pas authentifié avec Google. */
export function googleProfileOf(user: SupabaseAuthUser): GoogleProfile | null {
  const identity = user.identities?.find((i) => i.provider === "google");
  if (!identity) return null;
  const data = identity.identity_data ?? {};
  const meta = user.user_metadata ?? {};
  const sub = text(data.sub) ?? text(data.provider_id) ?? text(meta.provider_id) ?? text(meta.sub);
  const email = text(user.email) ?? text(data.email);
  if (!sub || !email) return null;
  const firstName = text(meta.given_name) ?? text(data.given_name);
  const lastName = text(meta.family_name) ?? text(data.family_name);
  return {
    sub,
    email,
    emailVerified: data.email_verified === true || meta.email_verified === true,
    name: text(meta.full_name) ?? text(meta.name) ?? ([firstName, lastName].filter(Boolean).join(" ") || null),
    firstName,
    lastName,
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
  };
}

export class GoogleSignInError extends Error {
  constructor(readonly reason: "unverified" | "account_exists") {
    super(reason);
  }
}

/**
 * Connecte ou crée le compte associé à un profil Google vérifié.
 * Une adresse déjà inscrite par mot de passe n'est pas rattachée automatiquement : Niala ne vérifie pas les e-mails à
 * l'inscription, et un inconnu aurait pu réserver cette adresse pour accéder ensuite au compte de son vrai propriétaire.
 */
export async function signInWithGoogle(profile: GoogleProfile) {
  if (!profile.emailVerified) throw new GoogleSignInError("unverified");
  const email = normalizeEmail(profile.email);
  const marker = googleMarker(profile.sub);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.passwordHash !== marker) throw new GoogleSignInError("account_exists");
    if (!profile.name || existing.name === profile.name) return publicUser(existing);
    return publicUser(await db.user.update({ where: { id: existing.id }, data: { name: profile.name } }));
  }
  return publicUser(await db.user.create({ data: { email, name: profile.name?.trim() || email.split("@")[0], passwordHash: marker, settings: { create: {} } } }));
}
