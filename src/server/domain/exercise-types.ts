// Constantes d'exercices sans dépendance serveur : importables côté client comme côté serveur.

export const QUESTION_TYPES = [
  "qcm_single",
  "qcm_multiple",
  "true_false",
  "fill_choices",
  "fill_blank",
  "short_answer",
  "definition",
  "open",
  "matching",
  "practical",
  "code",
  "sql",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const TYPE_LABEL: Record<QuestionType, string> = {
  qcm_single: "QCM (une réponse)",
  qcm_multiple: "QCM (plusieurs réponses)",
  true_false: "Vrai ou faux",
  fill_choices: "Phrase à compléter (avec propositions)",
  fill_blank: "Phrase à compléter (sans proposition)",
  short_answer: "Réponse courte",
  definition: "Question de définition",
  open: "Question ouverte",
  matching: "Relier des éléments",
  practical: "Exercice pratique",
  code: "Exercice de programmation",
  sql: "Exercice SQL",
};

export const DIFFICULTIES = ["facile", "moyenne", "difficile", "progressive", "melangee"] as const;
export const DIFFICULTY_LABEL: Record<(typeof DIFFICULTIES)[number], string> = {
  facile: "Facile",
  moyenne: "Moyenne",
  difficile: "Difficile",
  progressive: "Progressive",
  melangee: "Mélangée",
};

export const POINT_STEP = 0.25;
