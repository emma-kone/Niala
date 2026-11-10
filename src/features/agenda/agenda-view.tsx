"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Agenda : deux responsabilités clairement séparées.
//   • Emplois du temps : cours, pauses, plages horaires (importés ou créés à la main, plusieurs possibles).
//   • Tâches et rappels : ce que l'étudiant a à faire à une date et une heure précises, avec rappel.
// La section affichée se lit dans l'adresse (?section=taches), ce qui permet d'y arriver depuis les autres modules.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { TimetablesSection } from "./timetables-section";
import { TasksSection } from "./tasks-section";
import type { TaskDraft } from "./task-dialogs";

type Section = "edt" | "taches";

const SECTIONS: { id: Section; label: string; text: string; icon: typeof CalendarRange }[] = [
  { id: "edt", label: "Emplois du temps", text: "Cours, pauses et plages horaires", icon: CalendarRange },
  { id: "taches", label: "Tâches et rappels", text: "Ce que vous avez à faire, à l'heure prévue", icon: ListTodo },
];

export default function AgendaView() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [section, setSection] = useState<Section>(() => (search.get("section") === "taches" || search.get("action") === "task" ? "taches" : "edt"));
  const [importRequest, setImportRequest] = useState(0);
  const [draftRequest, setDraftRequest] = useState<{ n: number; draft: TaskDraft } | null>(null);
  const [handled, setHandled] = useState<string | null>(null);

  // Actions demandées depuis les autres modules (« Planifier », « Importer mon emploi du temps »…), traitées une fois.
  const action = search.get("action");
  const request = action ? search.toString() : null;
  if (request && request !== handled) {
    setHandled(request);
    if (action === "import") {
      setSection("edt");
      setImportRequest((n) => n + 1);
    }
    if (action === "task") {
      setSection("taches");
      setDraftRequest((r) => ({ n: (r?.n ?? 0) + 1, draft: { title: search.get("title") ?? undefined, type: search.get("type") ?? undefined, subjectId: search.get("subjectId"), documentId: search.get("documentId"), exerciseId: search.get("exerciseId") } }));
    }
    if (action === "add" || action === "today") setSection("edt");
  }
  useEffect(() => {
    if (action) router.replace(`${pathname}${action === "task" ? "?section=taches" : ""}`);
  }, [action, pathname, router]);

  function choose(next: Section) {
    setSection(next);
    router.replace(next === "taches" ? `${pathname}?section=taches` : pathname, { scroll: false });
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pt-6 pb-[calc(1.5rem+var(--toolbar-clearance,0px))] sm:px-6">
      {/* Titre et choix de la section sur une même ligne : les deux onglets sont en miniature. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="typo-h1">Agenda</h1>
        <div role="tablist" aria-label="Sections de l'agenda" className="flex gap-1 rounded-full border bg-card p-0.5">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" role="tab" id={`agenda-tab-${s.id}`} aria-selected={section === s.id} aria-controls="agenda-panel" title={s.text} onClick={() => choose(s.id)} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm", section === s.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <s.icon className="h-4 w-4 shrink-0" aria-hidden />
              {s.label}
            </button>
          ))}
        </div>
      </header>
      <div id="agenda-panel" role="tabpanel" aria-labelledby={`agenda-tab-${section}`}>
        {section === "edt" ? <TimetablesSection importRequest={importRequest} /> : <TasksSection draftRequest={draftRequest} />}
      </div>
    </div>
  );
}
