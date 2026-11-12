import { hmacFor, rateCount, rateLimit, rateReset } from "@/lib/auth";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Limitation de débit DURABLE (table RateLimit), pour les routes où un attaquant insiste : connexion, inscription,
// mot de passe oublié, assistance. Sur un hébergement « serverless », chaque instance a sa propre mémoire : un compteur
// en mémoire se contourne en étant simplement servi par une autre instance. Ici le compteur est en base, incrémenté de
// façon atomique, donc commun à toutes les instances.
// Si la base est indisponible (ou la migration pas encore appliquée), on retombe sur le compteur en mémoire : la
// protection se dégrade, mais la connexion des utilisateurs n'est jamais bloquée par une panne du compteur.
// ─────────────────────────────────────────────────────────────────────────────

/** Empreinte de la clé : la table ne contient ni adresse IP ni adresse e-mail en clair. */
const hashed = (key: string) => hmacFor("rate-limit", key);

let warned = false;
function degraded(err: unknown) {
  if (warned) return;
  warned = true;
  console.error("[rate-limit] compteur en base indisponible, repli sur la mémoire :", err instanceof Error ? err.message : err);
}

/** Supprime de temps en temps les compteurs expirés (sans attendre, sans jamais faire échouer la requête). */
function purgeSometimes() {
  if (Math.random() > 0.02) return;
  void db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } }).catch(() => undefined);
}

/** Compte une occurrence et renvoie le total dans la fenêtre en cours. */
export async function durableHit(key: string, windowMs: number): Promise<number> {
  const now = new Date();
  const reset = new Date(now.getTime() + windowMs);
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${hashed(key)}, 1, ${reset})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN ${reset} ELSE "RateLimit"."resetAt" END
      RETURNING "count"`;
    purgeSometimes();
    return Number(rows[0]?.count ?? 1);
  } catch (err) {
    degraded(err);
    rateLimit(key, Number.MAX_SAFE_INTEGER, windowMs);
    return rateCount(key);
  }
}

/** Vrai tant que la limite n'est pas dépassée (l'appel compte pour une occurrence). */
export async function durableLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  return (await durableHit(key, windowMs)) <= max;
}

/** Occurrences déjà comptées dans la fenêtre en cours (sans en ajouter). */
export async function durableCount(key: string): Promise<number> {
  try {
    const row = await db.rateLimit.findUnique({ where: { key: hashed(key) } });
    return row && row.resetAt > new Date() ? row.count : 0;
  } catch (err) {
    degraded(err);
    return rateCount(key);
  }
}

/** Remet un compteur à zéro (par exemple après une connexion réussie). */
export async function durableReset(key: string): Promise<void> {
  rateReset(key);
  try {
    await db.rateLimit.deleteMany({ where: { key: hashed(key) } });
  } catch (err) {
    degraded(err);
  }
}
