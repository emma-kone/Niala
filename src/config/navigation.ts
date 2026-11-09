import {
  BookOpen,
  CalendarDays,
  Database,
  FilePlus2,
  Home,
  MessageSquare,
  Network,
  NotebookPen,
  Settings,
  Terminal,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { routes } from "@/config/routes";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: "exact" | "prefix";
  alsoActiveFor?: string[];
  /** Adresses qui appartiennent à ce module bien qu'elles soient rangées ailleurs (exercice d'une matière, par exemple). */
  alsoActivePatterns?: RegExp[];
  /** Adresses qui ne doivent pas l'activer : une seule entrée de la navigation est active à la fois. */
  notActivePatterns?: RegExp[];
}

/** Un exercice reste dans le module « Exercices », qu'il soit rangé dans une matière ou non. */
const EXERCISE_IN_SUBJECT = /^\/matieres\/[^/]+\/exercices(\/|$)/;

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Général",
    items: [
      { href: routes.home, label: "Tableau de bord", icon: Home, match: "exact" },
      { href: routes.subjects, label: "Matières", icon: BookOpen, match: "prefix", notActivePatterns: [EXERCISE_IN_SUBJECT, /^\/matieres\/[^/]+\/cartes(\/|$)/] },
      { href: routes.agenda, label: "Agenda", icon: CalendarDays, match: "prefix" },
      { href: routes.exercises, label: "Exercices", icon: FilePlus2, match: "prefix", alsoActivePatterns: [EXERCISE_IN_SUBJECT] },
      { href: routes.code, label: "Labo de code", icon: Terminal, match: "prefix" },
      { href: routes.sql, label: "Labo SQL", icon: Database, match: "prefix" },
      { href: routes.assistant, label: "Assistant IA", icon: MessageSquare, match: "prefix" },
    ],
  },
  {
    label: "Outils",
    items: [
      { href: routes.notes, label: "Notes", icon: NotebookPen, match: "prefix" },
      { href: routes.maps, label: "Cartes mentales", icon: Network, match: "prefix", alsoActivePatterns: [/^\/matieres\/[^/]+\/cartes(\/|$)/] },
      { href: routes.progress, label: "Progression", icon: TrendingUp, match: "prefix" },
      { href: routes.settings, label: "Paramètres", icon: Settings, match: "prefix" },
    ],
  },
];

export const APP_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.notActivePatterns?.some((p) => p.test(pathname))) return false;
  if (item.alsoActivePatterns?.some((p) => p.test(pathname))) return true;
  if (item.match === "exact") {
    if (pathname === item.href) return true;
  } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  return (item.alsoActiveFor ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
