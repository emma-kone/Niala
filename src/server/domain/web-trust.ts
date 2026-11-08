// Fiabilité des sources web : règles pures. L'IA ne décide pas de la confiance accordée à un site ;
// le serveur classe chaque domaine et l'affiche à l'étudiant.

export type TrustTier = "reconnue" | "a_verifier";

/** Domaines dont le contenu est une référence : documentation officielle, standards, universités, revues. */
export const TRUSTED_DOMAINS = [
  "developer.mozilla.org", "developer.android.com", "android.com", "kotlinlang.org", "docs.python.org", "python.org",
  "docs.oracle.com", "oracle.com", "openjdk.org", "learn.microsoft.com", "microsoft.com", "typescriptlang.org", "nodejs.org",
  "react.dev", "w3.org", "whatwg.org", "ecma-international.org", "postgresql.org", "sqlite.org", "mysql.com", "mongodb.com",
  "isocpp.org", "cppreference.com", "gnu.org", "kernel.org", "git-scm.com", "docker.com", "kubernetes.io", "rust-lang.org",
  "go.dev", "php.net", "ruby-lang.org", "swift.org", "developer.apple.com", "cloud.google.com", "aws.amazon.com", "owasp.org",
  "ietf.org", "iso.org", "nist.gov", "wikipedia.org", "britannica.com", "khanacademy.org", "openclassrooms.com", "arxiv.org",
  "nature.com", "science.org", "ieee.org", "acm.org", "springer.com", "sciencedirect.com", "jstor.org", "persee.fr", "cairn.info",
  "openstax.org", "mit.edu", "stanford.edu", "harvard.edu", "inria.fr", "cnrs.fr", "education.gouv.fr", "eduscol.education.fr",
] as const;

/** Suffixes institutionnels (enseignement supérieur, administrations). */
const TRUSTED_SUFFIXES = [".edu", ".gov", ".gouv.fr", ".ac.uk", ".edu.au", ".ac.jp", ".ac.in", ".ac.ma", ".edu.sn"];

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function trustTier(host: string | null): TrustTier {
  if (!host) return "a_verifier";
  if (TRUSTED_SUFFIXES.some((s) => host.endsWith(s))) return "reconnue";
  if (/^univ-[a-z0-9-]+\.fr$/.test(host) || /\.univ-[a-z0-9-]+\.fr$/.test(host)) return "reconnue";
  return TRUSTED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`)) ? "reconnue" : "a_verifier";
}

export const TIER_LABEL: Record<TrustTier, string> = { reconnue: "source reconnue", a_verifier: "source à vérifier" };

/**
 * Niveau de fiabilité d'un ensemble de sources web, calculé par le serveur (jamais par l'IA) :
 *  - « verifiee »     : au moins une source reconnue (officielle, universitaire, référence) ;
 *  - « non_verifiee » : seulement des sources à vérifier (blogs, forums, sites commerciaux…) ;
 *  - « aucune »       : aucune source trouvée.
 * `independent` compte les domaines distincts : deux sites différents qui concordent valent mieux qu'un.
 */
export type WebReliability = "verifiee" | "non_verifiee" | "aucune";

export function assessReliability(sources: { host: string; tier: TrustTier }[]): { level: WebReliability; recognized: number; independent: number } {
  const hosts = new Set(sources.map((s) => s.host));
  const recognized = new Set(sources.filter((s) => s.tier === "reconnue").map((s) => s.host)).size;
  const level: WebReliability = !sources.length ? "aucune" : recognized > 0 ? "verifiee" : "non_verifiee";
  return { level, recognized, independent: hosts.size };
}

/** Consigne transmise à l'IA avec les résultats, selon le niveau calculé. */
export const RELIABILITY_RULE: Record<WebReliability, string> = {
  verifiee:
    "Au moins une source reconnue a été trouvée. Ne présente comme vérifié QUE ce que ces sources reconnues affirment explicitement, en les citant. Tout ce qui ne repose que sur une source « à vérifier » doit être signalé comme non officiel.",
  non_verifiee:
    "AUCUNE source officielle ou reconnue n'a été trouvée : seulement des sources « à vérifier ». Tu peux donner l'information, mais tu DOIS écrire clairement qu'elle n'est pas officielle ni vérifiée (ex. « ⚠️ Information non officielle, à vérifier : … ») et citer la source.",
  aucune:
    "Aucune source n'a été trouvée. Dis clairement à l'étudiant que tu n'as pas trouvé l'information (« ❌ Je n'ai pas trouvé de source fiable sur … »). Ne la reconstitue pas de mémoire en la faisant passer pour vérifiée.",
};
