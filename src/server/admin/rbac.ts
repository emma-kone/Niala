// ─────────────────────────────────────────────────────────────────────────────
// Contrôle d'accès par rôles (RBAC) du back-office. Les permissions sont vérifiées CÔTÉ SERVEUR dans chaque route
// d'API et chaque page d'administration (requireAdmin / requireAdminPage) ; l'interface se contente de masquer
// ce qui est inaccessible.
// ─────────────────────────────────────────────────────────────────────────────

export const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "SUPPORT", "ANALYST"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Super administrateur",
  ADMIN: "Administrateur",
  SUPPORT: "Support",
  ANALYST: "Analyste",
};

export const ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  SUPER_ADMIN: "Accès complet, gestion des administrateurs et des paramètres globaux.",
  ADMIN: "Gestion des utilisateurs, statistiques, suggestions et rapports.",
  SUPPORT: "Traitement des demandes et informations nécessaires au support.",
  ANALYST: "Statistiques agrégées, tendances et export des rapports.",
};

export const PERMISSIONS = [
  "overview.view", // vue d'ensemble, activité, fonctionnalités, activité pédagogique (données agrégées)
  "users.view", // liste et fiche détaillée des utilisateurs
  "users.support", // fiche réduite aux informations utiles au support
  "users.manage", // suspendre, réactiver, désactiver, modifier les renseignements administratifs
  "users.delete", // supprimer un compte
  "support.view",
  "support.manage", // répondre, changer le statut, notes internes, assignation, feuille de route
  "reports.view",
  "reports.export",
  "tech.view", // performance technique et supervision de l'IA
  "comms.view",
  "comms.send",
  "settings.view",
  "settings.manage",
  "admins.manage", // attribuer ou retirer un rôle d'administration
  "audit.view",
  "data.backfill", // reconstituer l'historique d'événements depuis les tables d'origine
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  ADMIN: ["overview.view", "users.view", "users.manage", "users.delete", "support.view", "support.manage", "reports.view", "reports.export", "tech.view", "comms.view", "comms.send", "settings.view", "audit.view"],
  SUPPORT: ["users.support", "support.view", "support.manage"],
  ANALYST: ["overview.view", "reports.view", "reports.export", "tech.view"],
};

export const isAdminRole = (v: unknown): v is AdminRole => typeof v === "string" && (ADMIN_ROLES as readonly string[]).includes(v);

export function permissionsOf(role: AdminRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function can(role: AdminRole | null | undefined, permission: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(permission);
}

/** Rubriques de navigation du back-office et permission nécessaire pour y accéder. */
export interface AdminSection {
  key: string;
  href: string;
  label: string;
  permission: Permission;
  /** Autres permissions donnant aussi accès à la rubrique. */
  alsoFor?: Permission[];
}

export const ADMIN_BASE = "/admin";

export const ADMIN_SECTIONS: AdminSection[] = [
  { key: "overview", href: ADMIN_BASE, label: "Vue d'ensemble", permission: "overview.view" },
  { key: "users", href: `${ADMIN_BASE}/utilisateurs`, label: "Utilisateurs", permission: "users.view", alsoFor: ["users.support"] },
  { key: "usage", href: `${ADMIN_BASE}/activite`, label: "Activité et utilisation", permission: "overview.view" },
  { key: "features", href: `${ADMIN_BASE}/fonctionnalites`, label: "Fonctionnalités", permission: "overview.view" },
  { key: "pedagogy", href: `${ADMIN_BASE}/pedagogie`, label: "Activité pédagogique", permission: "overview.view" },
  { key: "requests", href: `${ADMIN_BASE}/demandes`, label: "Suggestions et demandes", permission: "support.view" },
  { key: "reports", href: `${ADMIN_BASE}/rapports`, label: "Rapports et statistiques", permission: "reports.view" },
  { key: "tech", href: `${ADMIN_BASE}/performance`, label: "Performance technique", permission: "tech.view" },
  { key: "ai", href: `${ADMIN_BASE}/ia`, label: "Intelligence artificielle", permission: "tech.view" },
  { key: "comms", href: `${ADMIN_BASE}/communications`, label: "Notifications et communications", permission: "comms.view" },
  { key: "settings", href: `${ADMIN_BASE}/parametres`, label: "Paramètres d'administration", permission: "settings.view" },
  { key: "audit", href: `${ADMIN_BASE}/journal`, label: "Journal d'activité", permission: "audit.view" },
];

export function sectionsFor(role: AdminRole): AdminSection[] {
  return ADMIN_SECTIONS.filter((s) => can(role, s.permission) || (s.alsoFor ?? []).some((p) => can(role, p)));
}

/** Première rubrique accessible : page d'arrivée après connexion. */
export function landingFor(role: AdminRole): string {
  return sectionsFor(role)[0]?.href ?? ADMIN_BASE;
}
