// ─────────────────────────────────────────────────────────────────────────────
// Confidentialité de l'assistant IA du back-office : tout ce qui part vers le fournisseur d'IA passe par `sanitize`.
//  - les champs d'identité (e-mail, nom, nom d'auteur…) sont retirés et remplacés par un libellé pseudonyme stable ;
//  - les adresses e-mail et numéros de téléphone présents dans les textes libres sont masqués ;
//  - les noms rencontrés dans les champs d'identité sont aussi masqués s'ils réapparaissent dans un texte libre.
// Les identifiants internes (cuid) sont conservés : ils ne révèlent rien et permettent à l'IA de désigner un compte.
// ─────────────────────────────────────────────────────────────────────────────

import { hmacFor } from "@/lib/auth";

/** Clés dont la valeur identifie toujours une personne : jamais transmises au modèle. */
const IDENTITY_KEYS = new Set(["email", "userEmail", "actorEmail", "confirmEmail", "userName", "authorName", "guestEmail", "guestName"]);
/** Clés techniques sans intérêt pour l'analyse et potentiellement sensibles. */
const DROPPED_KEYS = new Set(["passwordHash", "googleSub", "storageKey", "actorKey", "ip", "userAgent", "sessionVersion", "guestNonce", "endpoint", "p256dh", "auth"]);

/**
 * `name` désigne une personne seulement dans un objet qui porte aussi une adresse (compte, administrateur) ;
 * ailleurs c'est le nom d'une matière, d'une notion, etc., conservé tel quel.
 */
const isIdentity = (key: string, obj: Record<string, unknown>) => IDENTITY_KEYS.has(key) || (key === "name" && ("email" in obj || "userEmail" in obj));

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Numéros de téléphone : 10 chiffres ou plus (format ivoirien 07 08 09 10 11, éventuellement précédé de +225), séparés
// par des espaces, points ou tirets. Les dates (8 chiffres) et références de demande (NL-2611-0001) ne sont pas touchées.
const PHONE_RE = /(?<![\w-])(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){9,14}\d(?![\w-])/g;

/** Libellé pseudonyme stable d'un compte : le même identifiant donne toujours le même libellé, sans être réversible. */
export function pseudonym(id: string, prefix = "Utilisateur"): string {
  return `${prefix} #${Buffer.from(hmacFor("admin-ai-pseudo", id), "base64url").toString("hex").slice(0, 6)}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function collectNames(value: unknown, out: Set<string>, depth = 0) {
  if (depth > 12 || value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) collectNames(v, out, depth + 1);
    return;
  }
  if (typeof value !== "object" || value instanceof Date) return;
  const obj = value as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (isIdentity(k, obj) && typeof v === "string") {
      const t = v.trim();
      // Le nom complet et chacune de ses parties suffisamment longues (prénom, nom).
      if (t.length >= 3 && !t.includes("@")) {
        out.add(t);
        for (const part of t.split(/\s+/)) if (part.length >= 4) out.add(part);
      }
      // La partie locale d'une adresse e-mail sert souvent de nom affiché.
      if (t.includes("@")) {
        const local = t.split("@")[0];
        if (local.length >= 4) out.add(local);
      }
    } else collectNames(v, out, depth + 1);
  }
}

function maskText(s: string, names: RegExp | null): string {
  let out = s.replace(EMAIL_RE, "[e-mail masqué]").replace(PHONE_RE, (m) => (m.replace(/\D/g, "").length >= 10 ? "[numéro masqué]" : m));
  if (names) out = out.replace(names, "[nom masqué]");
  return out;
}

function walk(value: unknown, names: RegExp | null, depth: number): unknown {
  if (value == null) return value;
  if (depth > 12) return "[contenu tronqué]";
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return maskText(value, names);
  if (Array.isArray(value)) return value.map((v) => walk(v, names, depth + 1));
  if (typeof value !== "object") return value;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const masked = new Set<string>();
  for (const [k, v] of Object.entries(src)) {
    if (DROPPED_KEYS.has(k)) continue;
    if (isIdentity(k, src)) {
      if (v != null) masked.add(k);
      continue;
    }
    out[k] = walk(v, names, depth + 1);
  }
  // Chaque identité retirée est remplacée par un libellé pseudonyme stable, rattaché au bon identifiant :
  // l'IA peut ainsi parler de « Utilisateur #a3f9c1 » ou « Admin #07be12 » sans connaître la personne.
  const str = (k: string) => (typeof src[k] === "string" ? (src[k] as string) : null);
  const isAdmin = src.adminRole != null || src.role != null || src.authorRole === "ADMIN";
  if ((masked.has("email") || masked.has("name")) && str("id") && !("label" in out)) out.label = pseudonym(str("id")!, isAdmin ? "Admin" : "Utilisateur");
  if ((masked.has("userEmail") || masked.has("userName")) && str("userId")) out.userLabel = pseudonym(str("userId")!);
  if (masked.has("actorEmail")) out.actorLabel = str("actorId") ? pseudonym(str("actorId")!, "Admin") : "Système";
  if (masked.has("authorName")) out.authorLabel = src.authorRole === "ADMIN" ? (str("authorId") ? pseudonym(str("authorId")!, "Admin") : "Équipe") : str("authorId") ? pseudonym(str("authorId")!) : "Utilisateur";
  return out;
}

/** Copie de `value` débarrassée des données d'identité, prête à être envoyée au modèle. */
export function sanitize<T>(value: T): unknown {
  const names = new Set<string>();
  collectNames(value, names);
  const list = [...names].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = list.length ? new RegExp(`(?<![\\p{L}\\d])(?:${list.join("|")})(?![\\p{L}\\d])`, "giu") : null;
  return walk(value, re, 0);
}

/** Masque e-mails et numéros dans un texte libre isolé (par exemple un message de l'administrateur). */
export const maskFreeText = (s: string) => maskText(s, null);

/** Limite la taille d'un résultat d'outil : au-delà, seul un extrait est transmis, avec une mention explicite. */
export function capSize(value: unknown, maxChars = 40_000): Record<string, unknown> {
  const json = JSON.stringify(value ?? null);
  if (json.length <= maxChars) return (value && typeof value === "object" && !Array.isArray(value) ? value : { result: value }) as Record<string, unknown>;
  return { truncated: true, note: `Résultat trop volumineux : seuls les ${maxChars} premiers caractères sont transmis. Affinez la demande (filtres, page, période).`, preview: json.slice(0, maxChars) };
}
