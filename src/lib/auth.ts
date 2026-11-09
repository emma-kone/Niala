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

function createToken(userId: string): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  const payload = `${userId}.${expStr}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) < Date.now()) return null;
  return userId;
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
  jar.set(COOKIE_NAME, createToken(userId), {
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
  const userId = verifyToken(token);
  if (!userId) return null;
  try {
    return await db.user.findUnique({ where: { id: userId } });
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
const rateBuckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.reset < now) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}
