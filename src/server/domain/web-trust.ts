import { PREFERRED_SEARCH_DOMAINS, assessSource } from "@/server/reliability/sources";

// Classement simplifié d'un site, conservé pour la recherche et les messages déjà enregistrés.
// Les règles sont dans reliability/sources.ts : le serveur classe chaque page, jamais l'IA.

export type TrustTier = "reconnue" | "a_verifier";

/** Domaines interrogés en priorité par la recherche restreinte. */
export const TRUSTED_DOMAINS = PREFERRED_SEARCH_DOMAINS;

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** « reconnue » = niveau 1 ou 2. Le chemin compte : un forum sur un domaine officiel reste « à vérifier ». */
export function trustTier(url: string): TrustTier {
  return assessSource({ url }).level <= 2 ? "reconnue" : "a_verifier";
}
