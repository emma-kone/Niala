// Périodes d'analyse : constantes sûres à importer côté navigateur (le calcul des bornes reste côté serveur, stats/common.ts).
export const PERIOD_KEYS = ["today", "7d", "30d", "3m", "6m", "12m", "custom"] as const;
export const PERIOD_LABELS: Record<(typeof PERIOD_KEYS)[number], string> = {
  today: "Aujourd'hui",
  "7d": "7 derniers jours",
  "30d": "30 derniers jours",
  "3m": "3 derniers mois",
  "6m": "6 derniers mois",
  "12m": "12 derniers mois",
  custom: "Période personnalisée…",
};
