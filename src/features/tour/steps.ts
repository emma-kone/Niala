import type { TourStep } from "@/components/tour/tour-logic";

// Contenu des visites guidées. Passer à `version: 2` dans le composant relance la visite pour tout le monde après une refonte.

const SIDE = 'aside[aria-label="Navigation principale"]';

export const STUDENT_TOUR_ID = "student";
export const STUDENT_TOUR: TourStep[] = [
  { id: "welcome", title: "Bienvenue sur Niala", body: "Une visite d'une minute pour repérer l'essentiel : vos cours, vos exercices, l'assistant IA et votre progression. Vous pouvez la quitter à tout moment avec Échap." },
  { id: "home", selector: `${SIDE} a[href="/"]`, placement: "right", title: "Votre tableau de bord", body: "Où vous en êtes, ce qui demande votre attention et la prochaine activité à faire." },
  { id: "subjects", selector: `${SIDE} a[href="/matieres"]`, placement: "right", title: "Matières et cours", body: "Créez une matière, importez vos cours (PDF, Word, présentations…) : Niala les range, les analyse et en tire un plan, des notions et des cartes mentales." },
  { id: "agenda", selector: `${SIDE} a[href="/agenda"]`, placement: "right", title: "Agenda", body: "Importez votre emploi du temps, planifiez vos séances de travail et suivez vos échéances." },
  { id: "exercises", selector: `${SIDE} a[href="/exercices"]`, placement: "right", title: "Exercices", body: "Générez des exercices à partir d'un cours ou d'un simple thème, ou importez un sujet existant. La correction détaillée et le tuteur vous guident sans donner la réponse trop tôt." },
  { id: "code", selector: `${SIDE} a[href="/code"]`, placement: "right", title: "Labo de code", body: "Écrivez et exécutez du Python, JavaScript ou TypeScript, avec des tests automatiques quand l'exercice en propose." },
  { id: "sql", selector: `${SIDE} a[href="/sql"]`, placement: "right", title: "Labo SQL", body: "Entraînez-vous aux requêtes sur une base d'exemple jetable : votre travail ne touche jamais de vraies données." },
  { id: "assistant", selector: `${SIDE} a[href="/assistant"]`, placement: "right", title: "Assistant IA", body: "Posez vos questions sur vos cours : les réponses citent leurs sources, et Niala indique quand il n'est pas sûr." },
  { id: "notes", selector: `${SIDE} a[href="/notes"]`, placement: "right", title: "Notes", body: "Vos notes personnelles, par matière ou liées à un passage de cours." },
  { id: "progress", selector: `${SIDE} a[href="/progression"]`, placement: "right", title: "Progression", body: "Votre maîtrise par notion, vos difficultés récurrentes et les révisions conseillées." },
  { id: "suggestions", selector: `${SIDE} a[href="/suggestions"]`, placement: "right", title: "Suggestions et retours", body: "Une idée, un bug, une difficulté ? Écrivez à l'équipe Niala, suivez votre demande et lisez les réponses ici." },
  { id: "settings", selector: `${SIDE} a[href="/reglages"]`, placement: "right", title: "Paramètres", body: "Thème, préférences d'apprentissage, notifications, données personnelles. Vous pourrez revoir cette visite depuis les préférences générales." },
  { id: "done", title: "C'est parti !", body: "Commencez par créer votre première matière et importer un cours. Bon travail !" },
];

export const ADMIN_TOUR_ID = "admin";
const NAV = 'nav[aria-label="Rubriques du back-office"]';
export const ADMIN_TOUR: TourStep[] = [
  { id: "welcome", title: "Bienvenue dans le back-office", body: "Le centre de pilotage de Niala : usage, utilisateurs, demandes, supervision technique et IA. Cette visite présente les repères ; Échap pour la quitter." },
  { id: "period", selector: '[data-tour="admin-period"]', placement: "bottom", title: "Période d'analyse", body: "Choisissez aujourd'hui, 7 jours, 3 mois… ou une période personnalisée : tous les indicateurs se recalculent et sont comparés à la période précédente." },
  { id: "overview", selector: `${NAV} a[href="/admin"]`, placement: "right", title: "Vue d'ensemble", body: "Les indicateurs essentiels : utilisateurs, utilisation, engagement. Chaque carte indique si le chiffre est mesuré sur tout l'historique ou depuis la collecte." },
  { id: "users", selector: `${NAV} a[href="/admin/utilisateurs"]`, placement: "right", title: "Utilisateurs", body: "Recherche, filtres, fiche détaillée et actions (suspendre, modifier, supprimer) — toujours avec confirmation et trace dans le journal." },
  { id: "usage", selector: `${NAV} a[href="/admin/activite"]`, placement: "right", title: "Activité et utilisation", body: "Carte de chaleur des heures d'activité, tendances, comparaison des catégories et fidélisation par cohortes." },
  { id: "features", selector: `${NAV} a[href="/admin/fonctionnalites"]`, placement: "right", title: "Fonctionnalités", body: "Adoption, abandon, erreurs et temps de traitement de chaque fonctionnalité, pour décider quoi améliorer." },
  { id: "pedagogy", selector: `${NAV} a[href="/admin/pedagogie"]`, placement: "right", title: "Activité pédagogique", body: "Exercices, matières, environnements pratiques et progression — en données agrégées et anonymisées." },
  { id: "requests", selector: `${NAV} a[href="/admin/demandes"]`, placement: "right", title: "Suggestions et demandes", body: "Traitez les retours des étudiants : réponse, statut, priorité, notes internes, assignation et feuille de route." },
  { id: "reports", selector: `${NAV} a[href="/admin/rapports"]`, placement: "right", title: "Rapports et statistiques", body: "Exportez en CSV, Excel ou PDF, sur la période choisie." },
  { id: "tech", selector: `${NAV} a[href="/admin/performance"]`, placement: "right", title: "Performance technique", body: "Temps de réponse, erreurs classées par origine, incidents et alertes automatiques." },
  { id: "ai", selector: `${NAV} a[href="/admin/ia"]`, placement: "right", title: "Intelligence artificielle", body: "Appels, échecs, temps de réponse et répartition par fonctionnalité et par modèle." },
  { id: "comms", selector: `${NAV} a[href="/admin/communications"]`, placement: "right", title: "Communications", body: "Annonces ciblées avec aperçu, confirmation et historique." },
  { id: "settings", selector: `${NAV} a[href="/admin/parametres"]`, placement: "right", title: "Paramètres d'administration", body: "Réglages globaux, rôles, collecte des données et définitions des indicateurs." },
  { id: "audit", selector: `${NAV} a[href="/admin/journal"]`, placement: "right", title: "Journal d'activité", body: "Qui a fait quoi, quand et avec quel résultat. Le journal ne peut pas être modifié." },
  { id: "quick", selector: '[data-tour="admin-quick"]', placement: "bottom", title: "Actions rapides", body: "Raccourcis vers les tâches fréquentes : demandes ouvertes, export, annonce, recherche d'un utilisateur." },
  { id: "bell", selector: '[data-tour="admin-bell"]', placement: "bottom", title: "Notifications", body: "Nouvelles demandes à examiner et alertes de supervision en cours." },
  { id: "profile", selector: '[data-tour="admin-profile"]', placement: "bottom", title: "Votre profil", body: "Votre rôle, la déconnexion — et « Revoir la visite guidée » à tout moment." },
  { id: "done", title: "Vous êtes prêt", body: "Les rubriques affichées dépendent de votre rôle. Bon pilotage !" },
];
