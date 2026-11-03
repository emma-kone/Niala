// ─────────────────────────────────────────────────────────────────────────────
// Isolation inter-utilisateurs : TOUTE lecture/écriture par identifiant passe par
// ces helpers. Un identifiant venant du client n'est jamais fiable seul.
// ─────────────────────────────────────────────────────────────────────────────

import { ApiHttpError } from "@/lib/api-helpers";

/** Filtre Prisma pour une ressource directement possédée (colonne userId). */
export function ownedBy(userId: string) {
  if (!userId) throw new Error("ownedBy : userId manquant.");
  return { userId } as const;
}

/** Filtre pour une ressource possédée via sa matière (ex. Folder, Note). */
export function ownedViaSubject(userId: string) {
  if (!userId) throw new Error("ownedViaSubject : userId manquant.");
  return { subject: { userId } } as const;
}

/** Renvoie la ressource ou lève un 404 (jamais 403 : on ne révèle pas l'existence). */
export function assertFound<T>(resource: T | null | undefined, label = "Ressource"): T {
  if (resource == null) throw new ApiHttpError(`${label} introuvable.`, 404);
  return resource;
}
