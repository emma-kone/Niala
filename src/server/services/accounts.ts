import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ApiHttpError } from "@/lib/api-helpers";
import { hashPassword, verifyPassword } from "@/lib/auth";
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
  constructor(readonly reason: "unverified" | "account_exists" | "account_conflict") {
    super(reason);
  }
}

const hasPassword = (hash: string) => hash.startsWith("scrypt$");

/**
 * Connecte ou crée le compte associé à un profil Google vérifié.
 * Un compte déjà lié à cet identifiant Google est ouvert directement. Une adresse inscrite par mot de passe n'est jamais
 * rattachée automatiquement : Niala ne vérifie pas les e-mails à l'inscription, et un inconnu aurait pu réserver cette
 * adresse pour accéder ensuite au compte de son vrai propriétaire. Il faut alors confirmer le mot de passe (linkGoogleAccount).
 */
export async function signInWithGoogle(profile: GoogleProfile) {
  if (!profile.emailVerified) throw new GoogleSignInError("unverified");
  const email = normalizeEmail(profile.email);
  const marker = googleMarker(profile.sub);

  const withLatestName = async (u: { id: string; email: string; name: string | null }) =>
    profile.name && u.name !== profile.name ? publicUser(await db.user.update({ where: { id: u.id }, data: { name: profile.name } })) : publicUser(u);

  const linked = await db.user.findUnique({ where: { googleSub: profile.sub } });
  if (linked) return withLatestName(linked);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.passwordHash === marker) {
      return withLatestName(await db.user.update({ where: { id: existing.id }, data: { googleSub: profile.sub } }));
    }
    // Adresse prise par un compte Google différent (ou lié à un autre identifiant) : rien à confirmer par mot de passe.
    if (!hasPassword(existing.passwordHash) || existing.googleSub) throw new GoogleSignInError("account_conflict");
    throw new GoogleSignInError("account_exists");
  }
  return publicUser(await db.user.create({ data: { email, googleSub: profile.sub, name: profile.name?.trim() || email.split("@")[0], passwordHash: marker, settings: { create: {} } } }));
}

export class LinkError extends Error {
  constructor(readonly reason: "invalid_password" | "unavailable") {
    super(reason);
  }
}

/**
 * Lie une identité Google au compte à mot de passe de même adresse, après confirmation du mot de passe Niala.
 * Les deux preuves sont nécessaires : Google atteste l'adresse, le mot de passe atteste le compte.
 */
export async function linkGoogleAccount(link: { sub: string; email: string; name: string | null }, password: string) {
  const user = await db.user.findUnique({ where: { email: normalizeEmail(link.email) } });
  if (!user || !hasPassword(user.passwordHash) || (user.googleSub && user.googleSub !== link.sub)) throw new LinkError("unavailable");
  if (!verifyPassword(password, user.passwordHash)) throw new LinkError("invalid_password");
  try {
    const linked = user.googleSub === link.sub ? user : await db.user.update({ where: { id: user.id }, data: { googleSub: link.sub } });
    return publicUser(linked);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new LinkError("unavailable"); // identité déjà liée ailleurs
    throw e;
  }
}
