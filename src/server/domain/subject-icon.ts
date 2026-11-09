// Icône d'une matière : déduite du SENS de son intitulé, puis enregistrée. Règles pures, sans dépendance à l'interface.

export const SUBJECT_ICON_IDS = [
  // Technologies (logo officiel)
  "java", "javascript", "typescript", "python", "php", "c", "cpp", "html", "css", "react", "vue", "angular", "node", "android", "kotlin", "swift", "go", "rust", "mysql", "postgresql", "mongodb", "linux", "git", "docker", "figma", "spring", "flutter",
  // Thèmes
  "code", "web", "mobile", "diagram", "agile", "project", "startup", "business", "database", "network", "security", "system", "cloud", "ai", "algorithm", "math", "statistics", "physics", "chemistry", "biology", "medicine", "law", "economics", "accounting", "marketing", "management", "communication", "languages", "literature", "history", "geography", "philosophy", "psychology", "design", "multimedia", "music", "sport", "generic",
] as const;

export type SubjectIconId = (typeof SUBJECT_ICON_IDS)[number];

export const isSubjectIconId = (v: unknown): v is SubjectIconId => typeof v === "string" && (SUBJECT_ICON_IDS as readonly string[]).includes(v);

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Découpe en mots en gardant « c++ », « c# » et « node.js » lisibles. */
function words(name: string): string[] {
  return fold(name).replace(/c\+\+/g, " cpp ").replace(/c#/g, " csharp ").replace(/node\.?js/g, " nodejs ").replace(/vue\.?js/g, " vuejs ").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

interface Rule {
  icon: SubjectIconId;
  /** Mots entiers (jamais de sous-chaîne : « java » ne reconnaît pas « javascript »). */
  terms?: string[];
  /** Expressions de plusieurs mots consécutifs. */
  phrases?: string[];
  /** Préfixes de mots, pour les familles lexicales (« programmation », « programmer »…). */
  prefixes?: string[];
  /** Plus le poids est élevé, plus la règle l'emporte quand plusieurs concordent. */
  weight: number;
}

// Du plus spécifique au plus général : une expression métier passe avant une technologie, une technologie avant un thème.
const RULES: Rule[] = [
  { icon: "diagram", terms: ["uml"], phrases: ["diagramme de classes", "modelisation objet", "analyse et conception"], weight: 90 },
  { icon: "agile", terms: ["agile", "scrum", "kanban", "agl", "devops"], phrases: ["genie logiciel", "cycle de vie"], weight: 85 },
  { icon: "web", phrases: ["developpement web", "application web", "applications web", "site web", "sites web", "programmation web"], weight: 82 },
  { icon: "mobile", phrases: ["developpement mobile", "application mobile", "applications mobiles"], weight: 82 },
  { icon: "project", phrases: ["gestion de projet", "gestion de projets", "management de projet", "conduite de projet", "pilotage de projet"], weight: 80 },
  { icon: "database", phrases: ["base de donnees", "bases de donnees"], terms: ["merise", "sql", "sgbd"], weight: 78 },
  { icon: "system", phrases: ["systeme d exploitation", "systemes d exploitation", "architecture des ordinateurs"], weight: 78 },
  { icon: "ai", phrases: ["intelligence artificielle", "machine learning", "apprentissage automatique", "deep learning", "reseaux de neurones"], terms: ["ia"], weight: 78 },
  { icon: "security", phrases: ["cyber securite", "securite informatique", "securite des systemes"], terms: ["cybersecurite", "cryptographie", "cryptologie"], weight: 78 },
  { icon: "algorithm", phrases: ["structure de donnees", "structures de donnees"], prefixes: ["algorithm", "algo"], weight: 76 },
  { icon: "network", phrases: ["reseaux informatiques", "reseau informatique"], terms: ["reseau", "reseaux", "tcp", "telecoms", "telecommunications"], weight: 72 },
  // Technologies
  { icon: "java", terms: ["java", "jee", "j2ee", "jakarta", "jsp", "servlet", "servlets"], weight: 70 },
  { icon: "spring", terms: ["spring", "springboot"], weight: 74 },
  { icon: "javascript", terms: ["javascript", "js", "ecmascript"], weight: 70 },
  { icon: "typescript", terms: ["typescript", "ts"], weight: 71 },
  { icon: "python", terms: ["python", "django", "flask"], weight: 70 },
  { icon: "php", terms: ["php", "laravel", "symfony"], weight: 70 },
  { icon: "cpp", terms: ["cpp"], weight: 71 },
  { icon: "c", phrases: ["langage c", "programmation c", "programmation en c"], weight: 70 },
  { icon: "html", terms: ["html", "html5"], weight: 69 },
  { icon: "css", terms: ["css", "css3", "sass"], weight: 68 },
  { icon: "react", terms: ["react", "reactjs", "nextjs"], weight: 71 },
  { icon: "vue", terms: ["vuejs", "nuxt"], weight: 66 },
  { icon: "angular", terms: ["angular"], weight: 71 },
  { icon: "node", terms: ["nodejs", "expressjs"], weight: 71 },
  { icon: "android", terms: ["android"], weight: 72 },
  { icon: "kotlin", terms: ["kotlin"], weight: 73 },
  { icon: "swift", terms: ["swift", "ios"], weight: 72 },
  { icon: "flutter", terms: ["flutter", "dart"], weight: 72 },
  { icon: "go", terms: ["golang"], weight: 70 },
  { icon: "rust", terms: ["rust"], weight: 70 },
  { icon: "mysql", terms: ["mysql", "mariadb"], weight: 80 },
  { icon: "postgresql", terms: ["postgresql", "postgres"], weight: 80 },
  { icon: "mongodb", terms: ["mongodb", "nosql"], weight: 80 },
  { icon: "linux", terms: ["linux", "unix", "ubuntu"], weight: 72 },
  { icon: "git", terms: ["git", "github", "gitlab"], weight: 72 },
  { icon: "docker", terms: ["docker", "conteneurs", "kubernetes"], weight: 72 },
  { icon: "figma", terms: ["figma"], weight: 72 },
  // Thèmes généraux
  { icon: "cloud", terms: ["cloud", "virtualisation"], weight: 60 },
  { icon: "web", terms: ["web", "internet", "frontend", "backend"], weight: 55 },
  { icon: "mobile", terms: ["mobile", "mobiles", "smartphone"], weight: 55 },
  { icon: "code", prefixes: ["programm", "developpement", "logiciel", "compilat", "informatique"], terms: ["poo", "objet"], weight: 45 },
  { icon: "startup", prefixes: ["entrepreneur", "innovation", "incubat"], terms: ["startup", "startups"], weight: 60 },
  { icon: "project", terms: ["projet", "projets", "planification", "gantt", "pert"], weight: 50 },
  { icon: "statistics", prefixes: ["statisti", "probabilit"], terms: ["econometrie"], weight: 60 },
  { icon: "math", prefixes: ["math", "algebr"], terms: ["analyse", "geometrie", "calcul", "trigonometrie"], weight: 48 },
  { icon: "physics", prefixes: ["physique", "mecanique", "thermodynamique", "electronique", "electricite", "optique"], weight: 55 },
  { icon: "chemistry", prefixes: ["chimi", "biochimi"], weight: 55 },
  { icon: "biology", prefixes: ["biolog", "genetique", "svt", "ecolog"], weight: 55 },
  { icon: "medicine", prefixes: ["medecin", "sante", "anatom", "pharma", "infirmi"], weight: 55 },
  { icon: "law", prefixes: ["juridi"], terms: ["droit", "loi", "legislation"], weight: 55 },
  { icon: "accounting", prefixes: ["comptab", "fiscal", "audit"], terms: ["finance", "finances", "financier", "financiere"], weight: 56 },
  { icon: "economics", prefixes: ["econom", "microeconom", "macroeconom"], weight: 55 },
  { icon: "marketing", prefixes: ["marketing", "mercatique", "publicit"], weight: 55 },
  { icon: "management", prefixes: ["management", "ressources", "leadership"], terms: ["gestion", "rh", "organisation"], weight: 42 },
  { icon: "business", terms: ["entreprise", "entreprises", "commerce", "commercial"], weight: 44 },
  { icon: "communication", prefixes: ["communicat", "journalis", "expression"], weight: 50 },
  { icon: "languages", prefixes: ["anglais", "espagnol", "allemand", "chinois", "arabe", "linguisti", "traduction"], terms: ["langue", "langues", "toeic", "toefl"], weight: 50 },
  { icon: "literature", prefixes: ["litterat", "francais", "lecture"], weight: 45 },
  { icon: "history", prefixes: ["histoire", "historique", "civilisation"], weight: 50 },
  { icon: "geography", prefixes: ["geograph", "cartograph"], weight: 50 },
  { icon: "philosophy", prefixes: ["philosoph", "ethique", "sociolog"], weight: 50 },
  { icon: "psychology", prefixes: ["psycholog", "neuroscien"], weight: 50 },
  { icon: "multimedia", prefixes: ["multimedia", "audiovisuel", "video", "cinema", "animation"], weight: 50 },
  { icon: "design", prefixes: ["design", "graphisme", "infographie", "ergonomie"], terms: ["ux", "ui", "art", "arts"], weight: 50 },
  { icon: "music", prefixes: ["musi", "solfege"], weight: 50 },
  { icon: "sport", prefixes: ["sport", "eps"], weight: 50 },
];

function matches(rule: Rule, tokens: string[], joined: string) {
  if (rule.terms?.some((t) => tokens.includes(t))) return true;
  if (rule.phrases?.some((p) => joined.includes(` ${p} `))) return true;
  return !!rule.prefixes?.some((p) => tokens.some((w) => w.startsWith(p)));
}

/** Icône la plus pertinente pour un intitulé ; « generic » quand rien de suffisamment précis n'est reconnu. */
export function suggestSubjectIcon(name: string): SubjectIconId {
  const tokens = words(name);
  const joined = ` ${tokens.join(" ")} `;
  let best: Rule | null = null;
  for (const rule of RULES) if ((!best || rule.weight > best.weight) && matches(rule, tokens, joined)) best = rule;
  return best?.icon ?? "generic";
}

/** Icône à afficher : celle enregistrée si elle est valide, sinon la déduction (même résultat à chaque actualisation). */
export const resolveSubjectIcon = (icon: string | null | undefined, name: string): SubjectIconId => (isSubjectIconId(icon) ? icon : suggestSubjectIcon(name));
