import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Porte d'entrée du back-office : adresse lisible (ADMIN_PATH) + code d'accès (ADMIN_ACCESS_HASH).
// Le code n'est jamais stocké en clair : seul son hachage scrypt l'est (format « sel.empreinte » en hexadécimal, sans « $ »
// pour ne pas être « développé » par les fichiers .env). Ce module n'importe ni base de données ni cookies : il sert aussi au proxy.
// ─────────────────────────────────────────────────────────────────────────────

export const GATE_COOKIE = "niala_gate";
export const GATE_MAX_AGE = 30 * 24 * 3600;
/** Page interne du code d'accès : atteinte uniquement par réécriture depuis l'adresse secrète, jamais directement. */
export const GATE_ROUTE = "/zz-gate";

const SECRET_SLUG = /^[A-Za-z0-9_-]{8,}$/;
const RESERVED = new Set(["admin", "api", "login", "auth", "matieres", "agenda", "exercices", "assistant", "reglages", "progression", "suggestions", "bibliotheque", "profil", "conditions", "confidentialite", "manifest", "zz-gate"]);

/** Adresse secrète configurée (sans « / »), ou chaîne vide si absente, trop courte ou réservée. */
export function gateSlug(): string {
  const slug = (process.env.ADMIN_PATH ?? "").trim().replace(/^\/+|\/+$/g, "");
  return SECRET_SLUG.test(slug) && !RESERVED.has(slug.toLowerCase()) ? slug : "";
}

const accessHash = () => (process.env.ADMIN_ACCESS_HASH ?? "").trim();
/** Vrai si un code d'accès est exigé avant la page de connexion. */
export const codeRequired = () => /^[0-9a-f]{32}\.[0-9a-f]{128}$/.test(accessHash());

/** Cookie de passage : lié à l'adresse ET au code (changer l'un ou l'autre invalide tous les cookies déjà délivrés). */
export function gateToken(slug: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET || slug).update(`admin-gate.${slug}.${accessHash()}`).digest("base64url");
}

export function cookieIsValid(value: string | undefined, slug: string): boolean {
  const given = value ?? "";
  const expected = gateToken(slug);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const normalize = (code: string) => code.trim().toLowerCase();

/** Hache un code d'accès pour ADMIN_ACCESS_HASH (utilisé par scripts/admin-access-code.mjs). */
export function hashAccessCode(code: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}.${scryptSync(normalize(code), salt, 64, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
}

export function verifyAccessCode(code: string, stored = accessHash()): boolean {
  try {
    const [salt, hash] = stored.split(".");
    if (!salt || !hash || code.length > 200) return false;
    const candidate = scryptSync(normalize(code), salt, 64, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}
