"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, CalendarPlus, FileUp, MessageSquare, NotebookPen, Plus, TrendingUp, type LucideIcon } from "lucide-react";
import { routes } from "@/config/routes";

// Barre d'actions flottante : uniquement des actions réelles, adaptées à la page. Absente des écrans plein cadre
// (assistant, lecteur, éditeurs), où elle masquerait la zone de travail ou le champ de saisie.

interface ToolAction {
  label: string;
  href: string;
  icon: LucideIcon;
  color: string;
}

const addCourse: ToolAction = { label: "Ajouter un cours", href: `${routes.agenda}?action=add`, icon: CalendarPlus, color: "var(--accent-sky)" };
const importSchedule: ToolAction = { label: "Importer mon emploi du temps", href: `${routes.agenda}?action=import`, icon: FileUp, color: "var(--accent-sun)" };
const agenda: ToolAction = { label: "Ouvrir l'agenda", href: routes.agenda, icon: CalendarDays, color: "var(--accent-sky)" };
const notes: ToolAction = { label: "Mes notes", href: routes.notes, icon: NotebookPen, color: "var(--accent-rose)" };
const assistant: ToolAction = { label: "Assistant IA", href: routes.assistant, icon: MessageSquare, color: "var(--accent-lilac)" };
const subjects: ToolAction = { label: "Mes matières", href: routes.subjects, icon: BookOpen, color: "var(--accent-mint)" };
const progress: ToolAction = { label: "Progression", href: routes.progress, icon: TrendingUp, color: "var(--accent-mint)" };
const exercises: ToolAction = { label: "Exercices", href: routes.exercises, icon: Plus, color: "var(--accent-sun)" };

const ACTIONS: Record<string, ToolAction[]> = {
  [routes.home]: [addCourse, importSchedule, notes, assistant, subjects],
  [routes.agenda]: [addCourse, importSchedule, assistant, notes],
  [routes.subjects]: [agenda, notes, assistant, progress],
  [routes.exercises]: [subjects, assistant, progress],
  [routes.progress]: [exercises, subjects, assistant],
  [routes.notes]: [subjects, assistant, agenda],
};

export const toolbarVisibleOn = (pathname: string) => pathname in ACTIONS;

export function FloatingToolbar() {
  const actions = ACTIONS[usePathname()];
  if (!actions) return null;
  return (
    <nav aria-label="Actions rapides" className="pointer-events-none sticky bottom-4 z-20 flex justify-center pb-1">
      <ul className="niala-toolbar pointer-events-auto flex items-center gap-1.5 rounded-full bg-[#101012] p-1.5 shadow-lg">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <li key={a.label}>
              <Link href={a.href} aria-label={a.label} title={a.label} className="flex h-9 w-9 items-center justify-center rounded-full text-black transition-transform hover:-translate-y-0.5" style={{ background: a.color }}>
                <Icon className="h-4 w-4" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
