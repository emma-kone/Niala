// Données de référence académiques de Niala : importables côté client comme côté serveur.
// Le profil ne porte qu'un champ libre « classe / filière » (ex. « DASI 3 ») ; les niveaux ci-dessous servent à la création d'exercices.

export const PROFILE_CATEGORIES = ["ESATIC", "OTHER_SCHOOL", "TESTER"] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

/** Réponses à la question « Êtes-vous étudiant à l'ESATIC ? ». */
export const CATEGORY_CHOICES: { value: ProfileCategory; title: string; text: string }[] = [
  { value: "ESATIC", title: "Oui", text: "Je suis étudiant à l'ESATIC." },
  { value: "OTHER_SCHOOL", title: "Non", text: "Je suis étudiant dans un autre établissement." },
  { value: "TESTER", title: "Je ne suis pas étudiant", text: "Je souhaite simplement découvrir et tester Niala." },
];

export const CATEGORY_LABEL: Record<ProfileCategory, string> = {
  ESATIC: "Étudiant ESATIC",
  OTHER_SCHOOL: "Étudiant d'un autre établissement",
  TESTER: "Testeur",
};

export const ESATIC_NAME = "ESATIC";

export const LEVELS = ["BTS1", "BTS2", "L1", "L2", "L3", "M1", "M2"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<Level, string> = {
  BTS1: "Première année de BTS",
  BTS2: "Deuxième année de BTS",
  L1: "Licence 1 (L1)",
  L2: "Licence 2 (L2)",
  L3: "Licence 3 (L3)",
  M1: "Master 1 (M1)",
  M2: "Master 2 (M2)",
};


/** « Autre » : le niveau n'est pas dans la liste, l'étudiant le précise librement. */
export const OTHER_LEVEL = "AUTRE";
export const LEVEL_CHOICES = [...LEVELS, OTHER_LEVEL] as const;
export type LevelChoice = (typeof LEVEL_CHOICES)[number];

export const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);
export const isLevelChoice = (v: unknown): v is LevelChoice => typeof v === "string" && (LEVEL_CHOICES as readonly string[]).includes(v);
/** Intitulé d'un niveau : celui de la liste, ou le texte saisi pour « Autre ». */
export const levelText = (level: string | null | undefined, other?: string | null): string | null => (level === OTHER_LEVEL ? other?.trim() || "Autre" : isLevel(level) ? LEVEL_LABEL[level] : null);
export const levelLabel = levelText;
