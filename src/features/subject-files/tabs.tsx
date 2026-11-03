"use client";

import Link from "next/link";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";

/** Onglets d'une matière. Chaque onglet n'apparaît que lorsque sa fonctionnalité existe réellement. */
export function SubjectTabs({ subjectId, active }: { subjectId: string; active: "files" | "notes" }) {
  const tabs = [
    { id: "files", label: "Fichiers", href: routes.subject(subjectId) },
    { id: "notes", label: "Notes", href: `${routes.subject(subjectId)}/notes` },
  ] as const;
  return (
    <nav aria-label="Sections de la matière" className="mb-5 flex gap-1 border-b">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={active === t.id ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            active === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
