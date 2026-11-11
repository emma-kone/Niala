// ─────────────────────────────────────────────────────────────────────────────
// DÉFINITIONS CENTRALES DES INDICATEURS (une seule source de vérité pour tout le back-office).
//
//  • Utilisateur ACTIF : au moins un événement « significatif » (ACTIVE_TYPES) sur la période. Une connexion,
//    une déconnexion ou le simple chargement d'une page ne comptent pas : ils ne prouvent pas un usage.
//  • SESSION : suite d'événements d'un même utilisateur sans interruption de plus de SESSION_GAP_MIN minutes.
//    Sa durée est l'écart entre son premier et son dernier événement (0 pour un événement isolé : on n'invente pas de durée).
//  • Exercice TERMINÉ : tentative dont le statut est GRADED ou SUBMITTED (le processus de résolution est finalisé).
//  • Exercice RÉUSSI : tentative terminée dont le score atteint SUCCESS_RATIO du barème.
//  • Exercice ABANDONNÉ : tentative restée IN_PROGRESS sans modification depuis plus de ABANDON_AFTER_DAYS jours.
//  • RÉTENTION Jn : part des inscrits d'une cohorte ayant une activité significative le n-ième jour suivant l'inscription.
//    Seules les cohortes assez anciennes pour avoir « vécu » ces n jours entrent dans le calcul.
//  • Données MESURÉES : lues dans les tables d'origine ou les événements collectés. Données ESTIMÉES : signalées comme telles.
// ─────────────────────────────────────────────────────────────────────────────

export const SESSION_GAP_MIN = 30;
export const SUCCESS_RATIO = 0.5;
export const ABANDON_AFTER_DAYS = 7;
/** Un compte est « inactif » s'il n'a aucune activité significative depuis ce nombre de jours. */
export const INACTIVE_AFTER_DAYS = 30;

export const EVENT_TYPES = [
  "account.register",
  "auth.login",
  "auth.logout",
  "module.open",
  "course.view",
  "exercise.generate",
  "exercise.start",
  "exercise.complete",
  "exercise.abandon",
  "document.import",
  "exercise.import",
  "map.create",
  "assistant.message",
  "lab.run",
  "lab.create",
  "progress.view",
  "suggestion.submit",
  "page.load",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Événements qui prouvent un usage de la plateforme (voir « Utilisateur ACTIF »). */
export const ACTIVE_TYPES: readonly EventType[] = [
  "module.open",
  "course.view",
  "exercise.generate",
  "exercise.start",
  "exercise.complete",
  "document.import",
  "exercise.import",
  "map.create",
  "assistant.message",
  "lab.run",
  "lab.create",
  "progress.view",
  "suggestion.submit",
];

/** Événements acceptés depuis le navigateur (/api/track) : rien qui puisse fausser les statistiques d'usage sensibles. */
export const CLIENT_TYPES: readonly EventType[] = ["module.open", "course.view", "progress.view", "page.load"];

export const MODULES = {
  dashboard: "Tableau de bord",
  subjects: "Matières",
  agenda: "Agenda",
  exercises: "Exercices",
  code: "Labo de code",
  sql: "Labo SQL",
  assistant: "Assistant IA",
  notes: "Notes",
  progress: "Progression",
  settings: "Paramètres",
  suggestions: "Suggestions et retours",
  documents: "Cours et documents",
  maps: "Cartes mentales",
  profile: "Profil",
} as const;
export type ModuleKey = keyof typeof MODULES;
export const isModule = (v: unknown): v is ModuleKey => typeof v === "string" && v in MODULES;

export const CATEGORIES = {
  ESATIC: "Étudiants ESATIC",
  OTHER_SCHOOL: "Étudiants d'autres établissements",
  TESTER: "Autres utilisateurs et testeurs",
  NONE: "Profil non renseigné",
} as const;
export type CategoryKey = keyof typeof CATEGORIES;
export const categoryLabel = (c: string | null | undefined) => CATEGORIES[(c ?? "NONE") as CategoryKey] ?? CATEGORIES.NONE;

/**
 * Fonctionnalités suivies et événements qui les mesurent. Seules les fonctionnalités réellement présentes dans
 * Niala figurent ici (pas d'atelier Merise ni d'éditeur mathématique : ils n'existent pas dans l'application).
 */
export interface FeatureDef {
  key: string;
  label: string;
  /** Types d'événements comptant une « utilisation ». */
  uses: EventType[];
  /** Type d'événement indiquant un démarrage / une fin, pour le taux d'abandon quand il a un sens. */
  started?: EventType;
  finished?: EventType;
  /** Module d'interface dont l'ouverture mesure l'adoption (en plus des utilisations). */
  module?: ModuleKey;
}

export const FEATURES: FeatureDef[] = [
  { key: "exercise-generation", label: "Génération d'exercices", uses: ["exercise.generate"], module: "exercises" },
  { key: "exercise-solving", label: "Exercices interactifs", uses: ["exercise.start"], started: "exercise.start", finished: "exercise.complete" },
  { key: "document-import", label: "Importation de cours", uses: ["document.import"], module: "subjects" },
  { key: "exercise-import", label: "Importation d'exercices", uses: ["exercise.import"] },
  { key: "mind-maps", label: "Cartes mentales", uses: ["map.create"] },
  { key: "assistant", label: "Assistant IA", uses: ["assistant.message"], module: "assistant" },
  { key: "labs", label: "Labos code et SQL", uses: ["lab.run", "lab.create"] },
  { key: "progress", label: "Suivi de progression", uses: ["progress.view"], module: "progress" },
  { key: "suggestions", label: "Suggestions et retours", uses: ["suggestion.submit"] },
];

export const LAB_LABELS: Record<string, string> = { CODE: "Labo de code", SQL: "Labo SQL" };

export const REQUEST_TYPES = {
  IMPROVEMENT: "Suggestion d'amélioration",
  FEATURE: "Demande de nouvelle fonctionnalité",
  BUG: "Signalement d'un problème technique",
  EXERCISE_DIFFICULTY: "Difficulté rencontrée pendant un exercice",
  AI_ISSUE: "Problème lié à l'IA",
  ASSISTANCE: "Demande d'assistance",
  OTHER: "Autre",
} as const;
export type RequestType = keyof typeof REQUEST_TYPES;

export const REQUEST_STATUSES = {
  RECEIVED: "Reçue",
  PENDING_REVIEW: "En attente d'examen",
  IN_PROGRESS: "En cours de traitement",
  NEEDS_INFO: "Une information complémentaire est nécessaire",
  RESOLVED: "Résolue",
  REJECTED: "Refusée",
} as const;
export type RequestStatus = keyof typeof REQUEST_STATUSES;
export const CLOSED_STATUSES: RequestStatus[] = ["RESOLVED", "REJECTED"];

/** À quoi sert chaque statut : affiché à l'équipe dans le back-office. L'étudiant est notifié à chaque changement. */
export const REQUEST_STATUS_HELP: Record<RequestStatus, string> = {
  RECEIVED: "Nouvelle demande, pas encore lue par l'équipe (statut de départ).",
  PENDING_REVIEW: "Lue, à examiner ; l'étudiant a aussi pu compléter sa demande.",
  IN_PROGRESS: "Prise en charge : quelqu'un s'en occupe (posé automatiquement à la première réponse).",
  NEEDS_INFO: "En attente de l'étudiant : il doit préciser quelque chose. Sa réponse remet la demande « en attente d'examen ».",
  RESOLVED: "Traitée : problème réglé ou suggestion prise en compte. Clôture la demande ; l'étudiant ne peut plus y répondre.",
  REJECTED: "Non retenue (hors sujet, doublon, impossible). Clôture la demande ; l'étudiant ne peut plus y répondre.",
};

export const PRIORITIES = { LOW: "Basse", NORMAL: "Normale", HIGH: "Haute", URGENT: "Urgente" } as const;
export type Priority = keyof typeof PRIORITIES;

export const ROADMAP_STATUSES = {
  TO_STUDY: "À étudier",
  PLANNED: "Planifiée",
  IN_DEV: "En développement",
  DEPLOYED: "Déployée",
  REJECTED: "Non retenue",
} as const;
export type RoadmapStatus = keyof typeof ROADMAP_STATUSES;

export const ACCOUNT_STATUSES = { ACTIVE: "Actif", SUSPENDED: "Suspendu", DISABLED: "Désactivé", DELETED: "Supprimé (anonymisé)" } as const;
export type AccountStatus = keyof typeof ACCOUNT_STATUSES;
