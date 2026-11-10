import {
  BookOpen,
  CalendarDays,
  Database,
  FilePlus2,
  Home,
  MessageSquare,
  MessageSquarePlus,
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
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Général",
    items: [
      { href: routes.home, label: "Tableau de bord", icon: Home, match: "exact" },
      { href: routes.subjects, label: "Matières", icon: BookOpen, match: "prefix" },
      { href: routes.agenda, label: "Agenda", icon: CalendarDays, match: "prefix" },
      { href: routes.exercises, label: "Exercices", icon: FilePlus2, match: "prefix" },
      { href: routes.code, label: "Labo de code", icon: Terminal, match: "prefix" },
      { href: routes.sql, label: "Labo SQL", icon: Database, match: "prefix" },
      { href: routes.assistant, label: "Assistant IA", icon: MessageSquare, match: "prefix" },
    ],
  },
  {
    label: "Outils",
    items: [
      { href: routes.notes, label: "Notes", icon: NotebookPen, match: "prefix" },
      { href: routes.progress, label: "Progression", icon: TrendingUp, match: "prefix" },
      { href: routes.suggestions, label: "Suggestions", icon: MessageSquarePlus, match: "prefix" },
      { href: routes.settings, label: "Paramètres", icon: Settings, match: "prefix" },
    ],
  },
];

export const APP_NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Un exercice rangé dans une matière (/matieres/<id>/exercices/…) appartient au module Exercices, pas à la liste des matières. */
const SUBJECT_EXERCISE_PATH = /^\/matieres\/[^/]+\/exercices(\/|$)/;

export function isNavActive(pathname: string, item: NavItem): boolean {
  const inExercises = SUBJECT_EXERCISE_PATH.test(pathname);
  if (inExercises && item.href === routes.exercises) return true;
  if (inExercises && item.href === routes.subjects) return false;
  if (item.match === "exact") {
    if (pathname === item.href) return true;
  } else if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
    return true;
  }
  return (item.alsoActiveFor ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
