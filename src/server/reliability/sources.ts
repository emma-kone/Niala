// ─────────────────────────────────────────────────────────────────────────────
// Évaluation des sources : règles pures, PAGE PAR PAGE (jamais « tout le site est fiable »).
//  Niveau 1 : sources primaires et institutionnelles (documentation officielle, lois, recherche, universités) ;
//  Niveau 2 : sources secondaires spécialisées (encyclopédies, sites éducatifs, médias sérieux, blogs d'éditeurs) ;
//  Niveau 3 : communautés et forums, même réputés : pistes, jamais preuves ;
//  Niveau 4 : pages personnelles, réseaux sociaux, sites inconnus.
// Le niveau décrit la NATURE de la source. Il ne dit pas si la page soutient une affirmation : ce contrôle
// est fait ensuite, affirmation par affirmation (voir claims.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type SourceLevel = 1 | 2 | 3 | 4;
export type SourceKind = "documentation" | "institution" | "universite" | "recherche" | "loi" | "reference" | "education" | "media" | "blog" | "forum" | "social" | "opinion" | "inconnu";

export interface SourceAssessment {
  level: SourceLevel;
  kind: SourceKind;
  /** Justification lisible de la classification. */
  reason: string;
}

export const LEVEL_LABEL: Record<SourceLevel, string> = {
  1: "source primaire ou institutionnelle",
  2: "source secondaire spécialisée",
  3: "forum ou communauté",
  4: "source non vérifiée",
};

export const KIND_LABEL: Record<SourceKind, string> = {
  documentation: "documentation officielle",
  institution: "institution publique",
  universite: "université",
  recherche: "publication scientifique",
  loi: "texte officiel ou juridiction",
  reference: "ouvrage de référence",
  education: "site éducatif",
  media: "média",
  blog: "blog",
  forum: "forum",
  social: "réseau social",
  opinion: "opinion",
  inconnu: "origine inconnue",
};

/** Documentation officielle des technologies, spécifications et normes. */
const DOCUMENTATION = [
  "developer.mozilla.org", "developer.android.com", "kotlinlang.org", "docs.python.org", "python.org", "docs.oracle.com", "openjdk.org", "learn.microsoft.com",
  "typescriptlang.org", "nodejs.org", "react.dev", "w3.org", "whatwg.org", "ecma-international.org", "postgresql.org", "sqlite.org", "dev.mysql.com", "docs.mongodb.com", "mongodb.com",
  "isocpp.org", "gnu.org", "kernel.org", "git-scm.com", "docs.docker.com", "docker.com", "kubernetes.io", "rust-lang.org", "go.dev", "php.net", "ruby-lang.org", "swift.org",
  "developer.apple.com", "cloud.google.com", "aws.amazon.com", "owasp.org", "ietf.org", "rfc-editor.org", "iso.org",
];
const LAW = ["legifrance.gouv.fr", "eur-lex.europa.eu", "conseil-constitutionnel.fr", "courdecassation.fr", "conseil-etat.fr", "curia.europa.eu", "echr.coe.int", "ohada.org"];
const RESEARCH = [
  "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "nature.com", "science.org", "ieee.org", "acm.org", "springer.com", "sciencedirect.com", "jstor.org", "persee.fr", "cairn.info",
  "thelancet.com", "nejm.org", "bmj.com", "cochranelibrary.com", "plos.org", "inria.fr", "cnrs.fr", "inserm.fr",
];
const INSTITUTIONS = ["who.int", "europa.eu", "un.org", "unesco.org", "oecd.org", "worldbank.org", "imf.org", "insee.fr", "pasteur.fr", "has-sante.fr", "ameli.fr", "nist.gov", "service-public.fr", "education.gouv.fr"];
const REFERENCE = ["wikipedia.org", "britannica.com", "cppreference.com", "arxiv.org", "larousse.fr"];
const EDUCATION = ["khanacademy.org", "openclassrooms.com", "openstax.org", "coursera.org", "edx.org"];
const MEDIA = ["reuters.com", "apnews.com", "afp.com", "lemonde.fr", "bbc.com", "bbc.co.uk", "nytimes.com", "theguardian.com", "france24.com", "rfi.fr", "sciencesetavenir.fr", "pourlascience.fr", "arstechnica.com", "lwn.net"];
/** Sites d'éditeurs : le domaine racine mêle produit, marketing et blogs ; ses pages de documentation sont listées plus haut. */
const VENDORS = ["microsoft.com", "oracle.com", "android.com", "google.com", "apple.com", "amazon.com"];

const FORUM_DOMAINS = [
  "stackoverflow.com", "stackexchange.com", "serverfault.com", "superuser.com", "askubuntu.com", "mathoverflow.net", "reddit.com", "quora.com", "news.ycombinator.com",
  "developpez.net", "commentcamarche.net", "forum-francais.com", "discord.com", "researchgate.net",
];
const SOCIAL = ["twitter.com", "x.com", "facebook.com", "instagram.com", "tiktok.com", "linkedin.com", "youtube.com", "pinterest.com", "threads.net", "t.me", "telegram.org"];
const BLOG_PLATFORMS = ["medium.com", "substack.com", "dev.to", "hashnode.dev", "wordpress.com", "blogspot.com", "tumblr.com", "wixsite.com"];

/** Domaines proposés à la recherche restreinte : on interroge d'abord les niveaux 1 et 2. */
export const PREFERRED_SEARCH_DOMAINS: readonly string[] = [...DOCUMENTATION, ...LAW, ...RESEARCH, ...INSTITUTIONS, ...REFERENCE, ...EDUCATION];

const matches = (host: string, list: readonly string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

const FORUM_HOST = /^(discuss|forum|forums|community|communities|users|answers|groups|lists|talk|meta|techcommunity)\./;
const FORUM_PATH = /\/(forums?|discussions?|community|communities|threads?)(\/|$)/;
const BLOG_HOST = /^blogs?\./;
const BLOG_PATH = /\/blogs?(\/|$)/;
const PERSONAL_PATH = /\/(~[\w.-]+|people\/[\w.-]+\/blog)(\/|$)/;
const OPINION_PATH = /\/(opinions?|tribunes?|editorials?)(\/|$)/;
const OPINION_TITLE = /^\s*(opinion|tribune|point de vue)\b/i;
const UNIVERSITY = /(^|\.)(edu|ac\.[a-z]{2}|edu\.[a-z]{2})$|(^|\.)univ-[a-z0-9-]+\.fr$/;
const GOVERNMENT = /(^|\.)(gov|gouv)(\.[a-z]{2})?$|\.int$/;

function parse(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return { host: u.hostname.toLowerCase().replace(/^www\./, ""), path: u.pathname.toLowerCase() };
  } catch {
    return null;
  }
}

/** Classe UNE page. Les signaux de la page (forum, blog, page personnelle) l'emportent toujours sur la réputation du domaine. */
export function assessSource(input: { url: string; title?: string }): SourceAssessment {
  const p = parse(input.url);
  if (!p) return { level: 4, kind: "inconnu", reason: "Adresse illisible." };
  const { host, path } = p;
  const title = input.title ?? "";

  if (matches(host, SOCIAL)) return { level: 4, kind: "social", reason: "Publication sur un réseau social." };
  if (PERSONAL_PATH.test(path)) return { level: 4, kind: "blog", reason: "Page personnelle, même hébergée par une institution." };
  if (matches(host, BLOG_PLATFORMS)) return { level: 4, kind: "blog", reason: "Blog hébergé sur une plateforme ouverte à tous." };
  if (matches(host, FORUM_DOMAINS)) return { level: 3, kind: "forum", reason: "Forum ou plateforme de questions-réponses : à confirmer ailleurs." };
  if (FORUM_HOST.test(host) || FORUM_PATH.test(path) || (host === "github.com" && /\/(discussions|issues|pull)(\/|$)/.test(path))) {
    return { level: 3, kind: "forum", reason: "Espace de discussion, même sur un site officiel." };
  }

  const known = matches(host, DOCUMENTATION) || matches(host, LAW) || matches(host, RESEARCH) || matches(host, INSTITUTIONS) || matches(host, REFERENCE) || matches(host, EDUCATION) || matches(host, MEDIA) || matches(host, VENDORS) || UNIVERSITY.test(host) || GOVERNMENT.test(host);
  if (known && (OPINION_PATH.test(path) || OPINION_TITLE.test(title))) return { level: 3, kind: "opinion", reason: "Tribune ou opinion : point de vue, pas un fait établi." };
  if (known && (BLOG_HOST.test(host) || BLOG_PATH.test(path))) return { level: 2, kind: "blog", reason: "Blog d'un organisme connu : utile, mais ce n'est pas sa documentation de référence." };

  if (matches(host, LAW)) return { level: 1, kind: "loi", reason: "Texte officiel ou décision d'une juridiction." };
  if (matches(host, RESEARCH)) return { level: 1, kind: "recherche", reason: "Éditeur scientifique ou organisme de recherche." };
  if (matches(host, EDUCATION)) return { level: 2, kind: "education", reason: "Site éducatif reconnu." };
  if (matches(host, DOCUMENTATION)) return { level: 1, kind: "documentation", reason: "Documentation officielle ou norme." };
  if (matches(host, INSTITUTIONS) || GOVERNMENT.test(host)) return { level: 1, kind: "institution", reason: "Organisme public ou international." };
  if (UNIVERSITY.test(host)) return { level: 1, kind: "universite", reason: "Établissement d'enseignement supérieur." };
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) return { level: 2, kind: "reference", reason: "Prépublication : pas nécessairement évaluée par les pairs." };
  if (matches(host, REFERENCE)) return { level: 2, kind: "reference", reason: "Ouvrage de référence, source secondaire." };
  if (matches(host, MEDIA)) return { level: 2, kind: "media", reason: "Média disposant d'une rédaction." };
  if (matches(host, VENDORS)) return { level: 2, kind: "reference", reason: "Site d'éditeur, hors documentation de référence." };
  if (host === "github.com") return { level: 3, kind: "forum", reason: "Dépôt public : son auteur et sa fiabilité restent à évaluer." };
  return { level: 4, kind: "inconnu", reason: "Site dont l'auteur ou les sources ne sont pas établis." };
}

export interface Publication {
  year: number | null;
  /** Date telle que trouvée, ex. « 2024-03-12 ». */
  label: string | null;
}

const DATE_IN_URL = /\/((?:19|20)\d{2})[/-](0[1-9]|1[0-2])(?:[/-](0[1-9]|[12]\d|3[01]))?(?:[/-]|$)/;
const DATE_IN_TEXT = /(?:last\s+(?:updated|modified)|updated(?:\s+on)?|published(?:\s+on)?|publi[ée]e?\s+le|mis\s+à\s+jour\s+le|derni[èe]re\s+mise\s+à\s+jour)[^0-9a-z]{0,6}([^.\n]{0,24}?\b((?:19|20)\d{2})\b)/i;

/** Date de publication, seulement si elle est lisible. Sinon null : on ne devine jamais une date. */
export function inferPublication(url: string, text: string, now = new Date()): Publication {
  const fromUrl = DATE_IN_URL.exec(url);
  if (fromUrl && Number(fromUrl[1]) <= now.getFullYear()) return { year: Number(fromUrl[1]), label: [fromUrl[1], fromUrl[2], fromUrl[3]].filter(Boolean).join("-") };
  const fromText = DATE_IN_TEXT.exec(text);
  if (fromText && Number(fromText[2]) <= now.getFullYear()) return { year: Number(fromText[2]), label: fromText[1].trim() };
  return { year: null, label: null };
}

/** Consigne transmise à l'IA avec les résultats. Elle ne dit jamais « vérifié » : le niveau d'un site ne prouve rien sur le sujet. */
export function searchGuidance(levels: SourceLevel[]): string {
  if (!levels.length) return "Aucune source n'a été trouvée. Dis clairement à l'étudiant que tu n'as pas trouvé l'information (« ❌ Je n'ai pas trouvé d'information fiable sur … »). Ne la reconstitue pas de mémoire.";
  const best = Math.min(...levels);
  const base = "Le niveau d'une source décrit sa nature, il ne prouve rien sur ce sujet. Vérifie que chaque extrait répond VRAIMENT à la question ; sinon ne le cite pas, et dis que tu n'as pas trouvé.";
  return best <= 2 ? base : `${base} Aucune source de niveau 1 ou 2 n'a été trouvée : ne présente rien comme établi.`;
}
