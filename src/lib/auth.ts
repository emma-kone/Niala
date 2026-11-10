import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const COOKIE_NAME = "sfs_session";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 jours
const SECRET_FILE = path.join(process.cwd(), "db", ".auth-secret");

// ── Secret de signature (persisté localement, surchargeable par AUTH_SECRET) ──
function getSecret(): string {
  const fromEnv = process.env.AUTH_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET (32 caractères minimum) est obligatoire en production.");
  }
  // Développement uniquement : secret local non versionné (db/ est ignoré par git).
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8").trim();
  const secret = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
  return secret;
}

/** HMAC dérivé du secret de l'application, avec un domaine de séparation : pseudonymes d'analyse, jetons d'administration. */
export function hmacFor(domain: string, value: string): string {
  return createHmac("sha256", getSecret()).update(`${domain}.${value}`).digest("base64url");
}

// ── Hachage de mot de passe : scrypt (N=16384) + sel aléatoire ───────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [algo, salt, hash] = stored.split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ── Jeton de session signé (HMAC-SHA256) ─────────────────────────────────────
function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

function createToken(userId: string, version: number): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${exp}.${version}`;
  return `${payload}.${sign(payload)}`;
}

/** Jeton actuel : identifiant.expiration.version.signature. Les jetons émis avant les versions (3 parties) valent version 0. */
function verifyToken(token: string): { userId: string; version: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const sig = parts.at(-1)!;
  const [userId, expStr] = parts;
  const version = parts.length === 4 ? Number(parts[2]) : 0;
  if (!Number.isInteger(version) || version < 0) return null;
  const payload = parts.slice(0, -1).join(".");
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Date.now()) return null;
  return { userId, version };
}

// ── Liaison Google en attente ────────────────────────────────────────────────
// Après un retour Google dont l'adresse correspond à un compte protégé par mot de passe, le profil Google (déjà vérifié
// par Supabase) est gardé 10 minutes dans un cookie signé, le temps que l'étudiant confirme son mot de passe Niala.
const LINK_COOKIE = "sfs_google_link";
const LINK_TTL_MS = 10 * 60 * 1000;

export interface PendingGoogleLink {
  sub: string;
  email: string;
  name: string | null;
}

const signLink = (payload: string) => createHmac("sha256", getSecret()).update(`google-link.${payload}`).digest("base64url");

export function createLinkToken(link: PendingGoogleLink, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...link, exp: now + LINK_TTL_MS })).toString("base64url");
  return `${payload}.${signLink(payload)}`;
}

export function verifyLinkToken(token: string, now = Date.now()): PendingGoogleLink | null {
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(signLink(payload));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PendingGoogleLink> & { exp?: number };
    if (typeof data.exp !== "number" || data.exp < now) return null;
    if (typeof data.sub !== "string" || !data.sub || typeof data.email !== "string" || !data.email) return null;
    return { sub: data.sub, email: data.email, name: typeof data.name === "string" ? data.name : null };
  } catch {
    return null;
  }
}

export async function setLinkCookie(link: PendingGoogleLink) {
  const jar = await cookies();
  jar.set(LINK_COOKIE, createLinkToken(link), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: LINK_TTL_MS / 1000 });
}

export async function getPendingLink(): Promise<PendingGoogleLink | null> {
  const token = (await cookies()).get(LINK_COOKIE)?.value;
  return token ? verifyLinkToken(token) : null;
}

export async function clearLinkCookie() {
  (await cookies()).set(LINK_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// ── Cookie de session (httpOnly, sameSite lax) ───────────────────────────────
export async function setSessionCookie(userId: string) {
  const jar = await cookies();
  const account = await db.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
  jar.set(COOKIE_NAME, createToken(userId, account?.sessionVersion ?? 0), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

// ── Utilisateur courant (contrôle serveur systématique) ──────────────────────
export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = verifyToken(token);
  if (!session) return null;
  try {
    const user = await db.user.findUnique({ where: { id: session.userId } });
    // Une session ouverte avant « Déconnecter tous les appareils » ou un changement de mot de passe n'est plus valable.
    // Un compte suspendu ou désactivé par l'administration perd aussi sa session en cours.
    return user && user.sessionVersion === session.version && user.accountStatus === "ACTIVE" ? user : null;
  } catch {
    return null;
  }
}

/** Garde d'API : renvoie l'utilisateur ou lève une réponse 401. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export class AuthError extends Error {
  status = 401;
  constructor() {
    super("Authentification requise");
  }
}

// ── Limitation de débit simple (en mémoire) pour les routes sensibles ────────
// Les clés sont toujours propres à un client (adresse IP, e-mail visé…) : une clé commune à tous
// permettrait à un inconnu de bloquer la connexion de tout le monde. Compteur propre à chaque instance.
const rateBuckets = new Map<string, { count: number; reset: number }>();
const MAX_BUCKETS = 50_000;

function purgeBuckets(now: number) {
  for (const [k, b] of rateBuckets) if (b.reset < now) rateBuckets.delete(k);
}

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (rateBuckets.size > MAX_BUCKETS) purgeBuckets(now);
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset < now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/** Nombre d'occurrences déjà comptées pour une clé dans sa fenêtre (sans en ajouter). */
export function rateCount(key: string): number {
  const bucket = rateBuckets.get(key);
  return bucket && bucket.reset >= Date.now() ? bucket.count : 0;
}

/** Remet un compteur à zéro (par exemple après une connexion réussie). */
export function rateReset(key: string) {
  rateBuckets.delete(key);
}
