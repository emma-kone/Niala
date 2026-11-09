"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Briefcase, Calendar, CalendarDays, CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, ClipboardPlus, FileUp, GraduationCap, MapPin, ListTodo, Palmtree, Plus, Repeat, Rows3, Settings2, Sparkles, TriangleAlert, User, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { confirmAction, notify } from "@/components/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { addDays, classifyOccurrence, computeGrid, formatMinutes, isoWeek, mondayOf, slotBox, weekLetter, weekday, type GridGeometry } from "@/server/domain/schedule";
import { EventDialog, type EditorState, type EventValues } from "./event-dialog";
import { ImportDialog } from "./import-dialog";
import { useModuleToolbar } from "@/components/layout/floating-toolbar";
import { PlanDialog, PrefsDialog, TaskDialog, type TaskDraft } from "./task-dialogs";
import { DAY_NAMES, PRIORITY_LABEL, STATUS_LABEL, TASK_META, colorOf, courseHint, dueLabel, formatDay, localClock, taskHint, type AgendaData, type BreakDto, type OccurrenceDto, type Scope, type SessionDto, type SubjectOption, type TaskDto } from "./types";

const PX_PER_HOUR = 64;
const SNAP = 15;
type View = "week" | "day" | "month" | "timeline" | "list";
type Content = "all" | "schedule" | "tasks";

const VIEWS: { id: View; label: string; icon: LucideIcon; color: string }[] = [
  { id: "week", label: "Semaine", icon: CalendarRange, color: "var(--accent-sky)" },
  { id: "day", label: "Jour", icon: CalendarDays, color: "var(--accent-sun)" },
  { id: "month", label: "Mois", icon: Calendar, color: "var(--accent-mint)" },
  { id: "timeline", label: "Chronologie", icon: Rows3, color: "var(--accent-lilac)" },
  { id: "list", label: "Tâches", icon: ListTodo, color: "var(--accent-rose)" },
];
const CONTENTS: { id: Content; label: string }[] = [{ id: "all", label: "Tout" }, { id: "schedule", label: "Emploi du temps" }, { id: "tasks", label: "Tâches" }];
const OPEN = (t: TaskDto) => t.status !== "TERMINE" && t.status !== "SOUMIS" && t.status !== "ANNULE";

/** Un cours correspond-il au type choisi dans le filtre ? */
function matchesType(o: OccurrenceDto, type: string) {
  if (!type) return true;
  if (type === "TD" || type === "TP") return (o.sessionType ?? "").toUpperCase().includes(type);
  if (type === "EXAMEN") return o.kind === "EXAM";
  if (type === "REVISION") return o.kind === "REVISION";
  return false;
}

/** Exécute une écriture ; un conflit (pause, chevauchement) devient une demande de confirmation. */
async function withConfirm(write: (force: boolean) => Promise<unknown>) {
  try {
    await write(false);
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && (await confirmAction(`${e.message} Enregistrer quand même ?`, { confirmLabel: "Enregistrer quand même", danger: false }))) {
      await write(true);
      return true;
    }
    if (e instanceof ApiError && e.status === 409) return false;
    throw e;
  }
}

/** Place côte à côte les séances qui se chevauchent : rien n'est masqué ni corrigé en silence. */
function layoutLanes(items: OccurrenceDto[]) {
  const ends: number[] = [];
  const placed = items.map((o) => {
    let lane = ends.findIndex((e) => e <= o.startMinutes);
    if (lane < 0) lane = ends.length;
    ends[lane] = o.endMinutes;
    return { o, lane };
  });
  return placed.map((p) => {
    const group = placed.filter((x) => x.o.startMinutes < p.o.endMinutes && p.o.startMinutes < x.o.endMinutes);
    return { ...p, lanes: Math.max(1, ...group.map((x) => x.lane + 1)), clash: group.length > 1 };
  });
}

function TaskBadge({ t, onOpen, compact }: { t: TaskDto; onOpen: () => void; compact?: boolean }) {
  const meta = TASK_META[t.type] ?? TASK_META.AUTRE;
  const Icon = meta.icon;
  const late = t.status === "EN_RETARD";
  return (
    <button type="button" onClick={onOpen} data-hint={taskHint(t)} data-hint-action="Consulter la tâche" className={cn("flex w-full items-center gap-1 rounded-lg border-l-4 bg-card px-1.5 py-0.5 text-left text-[11px] font-medium shadow-sm", late && "ring-1 ring-destructive", !OPEN(t) && "opacity-55 line-through")} style={{ borderLeftColor: meta.color }}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{compact ? t.title : `${meta.label} · ${t.title}`}</span>
    </button>
  );
}

function CourseCard({ o, state, lane, lanes, clash, grid, onOpen }: { o: OccurrenceDto; state: "past" | "current" | "upcoming"; lane: number; lanes: number; clash: boolean; grid: GridGeometry; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: o.key, data: { occurrence: o } });
  const color = colorOf(o);
  const box = slotBox(o, grid.start, PX_PER_HOUR);
  const short = box.height < 52;
  const tall = box.height >= 92;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={onOpen}
      data-hint={courseHint(o)}
      data-hint-action="Voir les détails"
      aria-label={`${courseHint(o)}${state === "current" ? ", en cours" : ""}`}
      style={{ top: box.top + 1, height: Math.max(18, box.height - 2), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, background: `color-mix(in srgb, ${color} 34%, var(--card))`, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, zIndex: isDragging ? 30 : 2 }}
      className={cn("absolute cursor-grab touch-none overflow-hidden rounded-2xl p-2 text-left text-xs leading-tight text-foreground transition-shadow hover:shadow-md active:cursor-grabbing", state === "past" && "opacity-55", state === "current" && "ring-2 ring-foreground", clash && "outline outline-2 outline-amber-500", isDragging && "shadow-xl")}
    >
      <span className="flex items-start justify-between gap-1">
        <span className={cn("font-semibold", short ? "truncate" : "line-clamp-2")}>{o.title}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {(clash || o.confidence === "faible") && <TriangleAlert className="h-3 w-3 text-amber-700 dark:text-amber-300" aria-label={clash ? "Chevauchement" : "Extraction incertaine"} />}
          {o.recurrence !== "NONE" && <Repeat className="h-3 w-3 opacity-60" aria-label="Cours répété" />}
          {o.sessionType && <span className="rounded bg-foreground/10 px-1 text-[9px] font-bold">{o.sessionType}</span>}
          {o.weekPattern !== "ALL" && <span className="rounded bg-foreground/10 px-1 text-[9px] font-bold">{o.weekPattern}</span>}
        </span>
      </span>
      {!short && <span className="tnum mt-0.5 block opacity-75">{formatMinutes(o.startMinutes)} – {formatMinutes(o.endMinutes)}</span>}
      {tall && o.room && <span className="mt-1 flex items-center gap-1 truncate opacity-75"><MapPin className="h-3 w-3 shrink-0" aria-hidden /> {o.room}</span>}
      {tall && o.teacher && <span className="flex items-center gap-1 truncate opacity-75"><User className="h-3 w-3 shrink-0" aria-hidden /> {o.teacher}</span>}
    </button>
  );
}

const breaksOn = (date: string, breaks: BreakDto[]) => breaks.filter((b) => b.weekday === null || b.weekday === weekday(date));

function DayColumn(props: { date: string; items: OccurrenceDto[]; specials: OccurrenceDto[]; tasks: TaskDto[]; sessions: { s: SessionDto; t: TaskDto }[]; breaks: BreakDto[]; grid: GridGeometry; height: number; now: { date: string; minutes: number }; onCreate: (start: number) => void; onOpen: (o: OccurrenceDto) => void; onOpenTask: (t: TaskDto) => void }) {
  const { date, items, specials, tasks, sessions, breaks, grid, height, now, onCreate, onOpen, onOpenTask } = props;
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const today = date === now.date;
  return (
    <div
      ref={setNodeRef}
      role="presentation"
      className={cn("relative border-l border-border/60", today && "bg-muted/40", isOver && "bg-primary/5")}
      style={{ height }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        onCreate(grid.start + Math.floor((y / PX_PER_HOUR) * 60 / SNAP) * SNAP);
      }}
    >
      {breaksOn(date, breaks).filter((b) => b.startMinutes >= grid.start && b.endMinutes <= grid.end).map((b) => {
        const box = slotBox(b, grid.start, PX_PER_HOUR);
        return (
          <div key={b.id} data-hint={`${b.label} · ${formatMinutes(b.startMinutes)} – ${formatMinutes(b.endMinutes)}`} className="niala-break absolute inset-x-0 flex items-center justify-center overflow-hidden" style={{ top: box.top, height: box.height }}>
            {box.height >= 16 && <span className="pointer-events-none truncate rounded-full bg-background/80 px-1.5 text-[10px] text-muted-foreground">{b.label}</span>}
          </div>
        );
      })}
      {specials.map((o) => {
        const wholeDay = o.startMinutes === 0 && o.endMinutes === 1440;
        const box = wholeDay ? { top: 0, height } : slotBox(o, grid.start, PX_PER_HOUR);
        const Icon = SPECIAL_ICON[o.kind as keyof typeof SPECIAL_ICON] ?? Briefcase;
        return (
          <button key={o.key} type="button" onClick={() => onOpen(o)} data-hint={specialHint(o)} data-hint-action="Voir les détails" className="absolute inset-x-0.5 z-[1] flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border border-dashed border-foreground/30 p-2 text-center text-xs font-semibold leading-tight" style={{ top: box.top, height: box.height, background: `color-mix(in srgb, ${SPECIAL_COLOR[o.kind as keyof typeof SPECIAL_COLOR] ?? "var(--accent-lilac)"} 45%, var(--card))` }}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span>{o.title}</span>
            {!wholeDay && <span className="tnum font-normal opacity-75">{formatMinutes(o.startMinutes)} – {formatMinutes(o.endMinutes)}</span>}
          </button>
        );
      })}
      {layoutLanes(items).map(({ o, lane, lanes, clash }) => <CourseCard key={o.key} o={o} lane={lane} lanes={lanes} clash={clash} grid={grid} state={classifyOccurrence(o, now.date, now.minutes)} onOpen={() => onOpen(o)} />)}
      {sessions.map(({ s, t }) => {
        const box = slotBox(s, grid.start, PX_PER_HOUR);
        return (
          <button key={s.id} type="button" onClick={() => onOpenTask(t)} data-hint={`Séance de travail · ${t.title} · ${formatMinutes(s.startMinutes)} – ${formatMinutes(s.endMinutes)}`} data-hint-action="Consulter la tâche" className={cn("absolute inset-x-1 z-[3] overflow-hidden rounded-xl border border-dashed border-[var(--niala-accent)] bg-[color-mix(in_srgb,var(--niala-accent)_16%,var(--card))] p-1.5 text-left text-[11px] leading-tight", s.done && "opacity-50")} style={{ top: box.top + 1, height: Math.max(18, box.height - 2) }}>
            <span className="flex items-center gap-1 font-medium"><Sparkles className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{t.title}</span></span>
          </button>
        );
      })}
      {tasks.filter((t) => t.dueMinutes !== null && t.dueMinutes >= grid.start && t.dueMinutes <= grid.end).map((t) => (
        <div key={t.id} className="absolute inset-x-1 z-[4]" style={{ top: slotBox({ startMinutes: t.dueMinutes!, endMinutes: t.dueMinutes! + 1 }, grid.start, PX_PER_HOUR).top - 10 }}>
          <TaskBadge t={t} compact onOpen={() => onOpenTask(t)} />
        </div>
      ))}
      {today && now.minutes >= grid.start && now.minutes <= grid.end && (
        <div className="pointer-events-none absolute inset-x-0 z-20 h-px bg-foreground" style={{ top: slotBox({ startMinutes: now.minutes, endMinutes: now.minutes + 1 }, grid.start, PX_PER_HOUR).top }} aria-hidden>
          <span className="niala-pointer-right absolute -left-1 -top-[5px]" />
        </div>
      )}
    </div>
  );
}

const SPECIAL_ICON = { HOLIDAY: Palmtree, EXAM: GraduationCap, SPECIAL: Briefcase };
const SPECIAL_COLOR = { HOLIDAY: "var(--accent-mint)", EXAM: "var(--accent-rose)", SPECIAL: "var(--accent-lilac)" };
const specialHint = (o: OccurrenceDto) => `${o.title}${o.endDate && o.endDate > o.originalDate ? ` · jusqu'au ${formatDay(o.endDate, { day: "numeric", month: "long" })}` : ""}`;

function SpecialChip({ o, onOpen }: { o: OccurrenceDto; onOpen: () => void }) {
  const Icon = SPECIAL_ICON[o.kind as keyof typeof SPECIAL_ICON] ?? Briefcase;
  return (
    <button type="button" onClick={onOpen} data-hint={specialHint(o)} className="flex w-full items-center gap-1 rounded-lg bg-muted px-1.5 py-0.5 text-left text-[11px] font-medium">
      <Icon className="h-3 w-3 shrink-0" aria-hidden /><span className="truncate">{o.title}</span>
    </button>
  );
}

function TaskList({ tasks, onOpen, onStatus }: { tasks: TaskDto[]; onOpen: (t: TaskDto) => void; onStatus: (t: TaskDto, s: string) => void }) {
  if (!tasks.length) return <p className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">Aucune tâche pour ce filtre. Ajoutez un devoir, un TD à rendre ou une révision.</p>;
  return (
    <ul className="space-y-2">
      {tasks.map((t) => {
        const meta = TASK_META[t.type] ?? TASK_META.AUTRE;
        const Icon = meta.icon;
        return (
          <li key={t.id} className={cn("flex flex-wrap items-center gap-3 rounded-2xl border-l-4 bg-card p-3", t.status === "EN_RETARD" && "ring-1 ring-destructive", !OPEN(t) && "opacity-60")} style={{ borderLeftColor: meta.color }}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(t)} data-hint={taskHint(t)} data-hint-action="Modifier">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" aria-hidden /> {meta.label}{t.subject ? ` · ${t.subject.name}` : ""}{t.parentId ? " · étape" : ""}</span>
              <span className="block truncate font-semibold">{t.title}</span>
              <span className={cn("text-xs font-medium", t.status === "EN_RETARD" ? "text-destructive" : "text-foreground/80")}>Pour {dueLabel(t)}</span>
            </button>
            <span className="text-xs text-muted-foreground">{t.priority === "HAUTE" ? `Priorité ${PRIORITY_LABEL.HAUTE.toLowerCase()}` : ""}</span>
            <select aria-label={`Statut de ${t.title}`} className="h-8 rounded-full border bg-background px-2 text-xs" value={t.storedStatus} onChange={(e) => onStatus(t, e.target.value)}>
              {(["A_COMMENCER", "EN_COURS", "EN_ATTENTE", "TERMINE", "SOUMIS", "ANNULE"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            {t.status === "EN_RETARD" && <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-medium text-white">En retard</span>}
          </li>
        );
      })}
    </ul>
  );
}

export default function AgendaView() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [now, setNow] = useState(localClock);
  const [anchor, setAnchor] = useState(() => localClock().date);
  const [view, setView] = useState<View>("week");
  const [content, setContent] = useState<Content>("all");
  const [typeFilter, setTypeFilter] = useState("");
  const [data, setData] = useState<AgendaData | null>(null);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [taskEditor, setTaskEditor] = useState<{ task: TaskDto | null; draft?: TaskDraft } | null>(null);
  const [planning, setPlanning] = useState<TaskDto | null>(null);
  const [importing, setImporting] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [askScope, setAskScope] = useState<{ title: string; apply: (s: Scope) => Promise<void> } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const weekStart = mondayOf(anchor);
  const monthStart = mondayOf(`${anchor.slice(0, 8)}01`);
  const range = useMemo(() => {
    if (view === "month") return [monthStart, addDays(monthStart, 41)] as const;
    if (view === "timeline") return [weekStart, addDays(weekStart, 30)] as const;
    return [weekStart, addDays(weekStart, 6)] as const;
  }, [view, monthStart, weekStart]);
  const days = useMemo(() => (view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))), [view, anchor, weekStart]);

  const load = useCallback(async () => {
    const c = localClock();
    try {
      const [agenda, list] = await Promise.all([api.get<AgendaData>(`/api/agenda?from=${range[0]}&to=${range[1]}`), api.get<{ tasks: TaskDto[] }>(`/api/agenda/tasks?date=${c.date}&minutes=${c.minutes}`)]);
      setData(agenda);
      setTasks(list.tasks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(localClock()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Actions demandées depuis la barre d'outils ou les autres modules.
  const action = search.get("action");
  useEffect(() => {
    if (!action) return;
    if (action === "import") setImporting(true);
    if (action === "add") setEditor({ mode: "create", date: localClock().date, startMinutes: 480, endMinutes: 570 });
    if (action === "today") setAnchor(localClock().date);
    if (action === "task") setTaskEditor({ task: null, draft: { title: search.get("title") ?? undefined, type: search.get("type") ?? undefined, subjectId: search.get("subjectId"), documentId: search.get("documentId"), exerciseId: search.get("exerciseId") } });
    router.replace(pathname);
  }, [action, pathname, router, search]);

  const showCourses = content !== "tasks";
  const showTasks = content !== "schedule";
  const visibleTasks = useMemo(() => tasks.filter((t) => !typeFilter || t.type === typeFilter), [tasks, typeFilter]);
  const shownOccurrences = useMemo(() => (data && showCourses ? data.occurrences.filter((o) => matchesType(o, typeFilter)) : []), [data, showCourses, typeFilter]);
  const coursesOn = (date: string) => shownOccurrences.filter((o) => o.date === date && !o.allDay);
  const specialsOn = (date: string) => shownOccurrences.filter((o) => o.date === date && o.allDay);
  const tasksOn = (date: string) => (showTasks ? visibleTasks.filter((t) => t.dueDate === date) : []);
  const sessionsOn = (date: string) => (showTasks ? visibleTasks.flatMap((t) => t.sessions.filter((s) => s.date === date).map((s) => ({ s, t }))) : []);

  // La grille se calcule à partir des horaires réels de la période affichée.
  const grid = useMemo(() => {
    const occ = shownOccurrences.filter((o) => days.includes(o.date) && !o.allDay);
    const study = days.flatMap((d) => (showTasks ? visibleTasks.flatMap((t) => t.sessions.filter((s) => s.date === d)) : []));
    const due = days.flatMap((d) => (showTasks ? visibleTasks.filter((t) => t.dueDate === d && t.dueMinutes !== null).map((t) => ({ startMinutes: t.dueMinutes!, endMinutes: t.dueMinutes! })) : []));
    const timed = shownOccurrences.filter((o) => days.includes(o.date) && o.allDay && o.endMinutes < 1440);
    const relevant = (data?.breaks ?? []).filter((b) => days.some((d) => b.weekday === null || b.weekday === weekday(d)));
    return computeGrid([...occ, ...timed, ...study, ...due], relevant);
  }, [days, data, shownOccurrences, showTasks, visibleTasks]);
  const gridHeight = slotBox({ startMinutes: grid.start, endMinutes: grid.end }, grid.start, PX_PER_HOUR).height;
  const columns = `60px repeat(${days.length}, minmax(${days.length === 1 ? 240 : 112}px, 1fr))`;

  async function patchEvent(o: OccurrenceDto, values: Partial<EventValues>, scope: Scope) {
    const saved = await withConfirm((force) => api.patch(`/api/agenda/events/${o.eventId}`, { ...values, scope, occurrenceDate: o.originalDate, force }));
    if (saved) {
      notify({ title: "Agenda mis à jour", variant: "success" });
      await load();
    }
    return saved;
  }

  function onDragEnd(e: DragEndEvent) {
    const o = e.active.data.current?.occurrence as OccurrenceDto | undefined;
    if (!o || !e.over) return;
    const date = String(e.over.id);
    const duration = o.endMinutes - o.startMinutes;
    const start = Math.max(0, Math.min(1440 - duration, o.startMinutes + Math.round(((e.delta.y / PX_PER_HOUR) * 60) / SNAP) * SNAP));
    if (date === o.date && start === o.startMinutes) return;
    const values = { date, startMinutes: start, endMinutes: start + duration };
    const run = async (scope: Scope) => {
      try {
        await patchEvent(o, values, scope);
      } catch (err) {
        notify({ title: "Déplacement impossible", description: err instanceof Error ? err.message : undefined, variant: "error" });
      }
    };
    if (o.recurrence !== "NONE") setAskScope({ title: o.title, apply: run });
    else void run("all");
  }

  async function submit(values: EventValues, scope: Scope) {
    if (editor?.mode === "edit") {
      if (await patchEvent(editor.occurrence, values, scope)) setEditor(null);
      return;
    }
    const saved = await withConfirm((force) => api.post("/api/agenda/events", { ...values, title: values.title || undefined, force }));
    if (saved) {
      notify({ title: "Cours ajouté", variant: "success" });
      setEditor(null);
      await load();
    }
  }

  async function remove(scope: Scope) {
    if (editor?.mode !== "edit") return;
    const o = editor.occurrence;
    const series = o.recurrence !== "NONE" && scope === "all";
    if (!(await confirmAction(series ? `Supprimer toutes les séances de « ${o.title} » ?` : `Supprimer « ${o.title} » ?`, { confirmLabel: "Supprimer" }))) return;
    await api.del(`/api/agenda/events/${o.eventId}?scope=${scope}&date=${o.originalDate}`);
    notify({ title: "Cours supprimé", variant: "success" });
    setEditor(null);
    await load();
  }

  async function duplicate() {
    if (editor?.mode !== "edit") return;
    const o = editor.occurrence;
    const saved = await withConfirm((force) => api.post("/api/agenda/events", { title: o.title, subjectId: o.subjectId, kind: o.kind, date: addDays(o.date, 1), startMinutes: o.startMinutes, endMinutes: o.endMinutes, recurrence: o.recurrence === "WEEKLY" ? "WEEKLY" : "NONE", until: o.until, weekPattern: o.weekPattern, room: o.room, teacher: o.teacher, groupName: o.groupName, description: o.description, sessionType: o.sessionType, code: o.code, force }));
    if (saved) {
      notify({ title: "Cours dupliqué", description: "La copie est placée le lendemain : déplacez-la si besoin.", variant: "success" });
      setEditor(null);
      await load();
    }
  }

  async function setStatus(t: TaskDto, status: string) {
    try {
      await api.patch(`/api/agenda/tasks/${t.id}`, { status });
      await load();
    } catch (e) {
      notify({ title: "Modification impossible", description: e instanceof Error ? e.message : undefined, variant: "error" });
    }
  }

  async function toggleWeekSwap() {
    if (!data) return;
    await api.patch("/api/agenda/settings", { weekSwap: !data.weekSwap });
    await load();
  }

  /** Date de référence de la période précédente ou suivante. */
  const step = (dir: 1 | -1) => {
    if (view === "day") return addDays(anchor, dir);
    if (view !== "month") return addDays(anchor, 7 * dir);
    const d = new Date(`${anchor.slice(0, 8)}15T12:00:00`);
    d.setMonth(d.getMonth() + dir);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-15`;
  };
  const periodLabel = (date: string) => {
    if (view === "month") return formatDay(`${date.slice(0, 8)}15`, { month: "long", year: "numeric" });
    if (view === "day") return formatDay(date, { weekday: "short", day: "numeric", month: "short" });
    const monday = mondayOf(date);
    return `${formatDay(monday, { day: "numeric", month: "short" })} – ${formatDay(addDays(monday, 6), { day: "numeric", month: "short" })}`;
  };
  const addSubject = (s: SubjectOption) => setData((d) => (d ? { ...d, subjects: [...d.subjects, s] } : d));
  const openCreate = (date: string, start: number) => setEditor({ mode: "create", date, startMinutes: start, endMinutes: Math.min(1440, start + 60) });
  const openOccurrence = (o: OccurrenceDto) => setEditor({ mode: "edit", occurrence: o });
  const openTask = (t: TaskDto) => setTaskEditor({ task: t });
  const openDay = (date: string) => {
    setAnchor(date);
    setView("day");
  };
  const late = tasks.filter((t) => t.status === "EN_RETARD").length;
  useModuleToolbar(VIEWS.map((v) => ({ label: v.label, icon: v.icon, color: v.color, active: view === v.id, onClick: () => setView(v.id) })));
  const heading = view === "month" ? formatDay(`${anchor.slice(0, 8)}15`, { month: "long", year: "numeric" }) : view === "day" ? formatDay(anchor, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : `${formatDay(weekStart, { day: "numeric", month: "long" })} – ${formatDay(addDays(weekStart, 6), { day: "numeric", month: "long", year: "numeric" })} · semaine ${isoWeek(weekStart)}`;
  const timeline = useMemo(() => Array.from({ length: 31 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const pill = (active: boolean) => cn("rounded-full px-3 py-1 text-xs font-medium transition-colors", active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted");

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 pt-6 pb-[calc(1.5rem+var(--toolbar-clearance,0px))] sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="typo-h1">Agenda</h1>
          <p className="typo-subtitle mt-0.5 first-letter:uppercase">
            {heading}
            {data && view === "week" && <button type="button" data-hint="Inverser semaines A et B selon votre établissement" className="ml-2 rounded-full border px-2 py-px text-xs normal-case hover:bg-muted" onClick={() => void toggleWeekSwap()}>Semaine {weekLetter(weekStart, data.weekSwap)}</button>}
            {late > 0 && <span data-hint={`${late} tâche(s) en retard`} className="ml-2 rounded-full bg-destructive px-2 py-0.5 text-xs normal-case text-white">{late} en retard</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border p-0.5">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={`Période précédente : ${periodLabel(step(-1))}`} data-hint={`Période précédente : ${periodLabel(step(-1))}`} onClick={() => setAnchor(step(-1))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
            <span className="tnum min-w-28 px-1 text-center text-sm font-medium first-letter:uppercase" aria-live="polite">{periodLabel(anchor)}</span>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={`Période suivante : ${periodLabel(step(1))}`} data-hint={`Période suivante : ${periodLabel(step(1))}`} onClick={() => setAnchor(step(1))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
          </div>
          <Button variant="ghost" size="sm" className="h-7 rounded-full border px-2.5 text-xs" data-hint="Revenir à aujourd'hui" onClick={() => setAnchor(now.date)}>Aujourd&apos;hui</Button>
          <Button variant="outline" size="icon" className="h-9 w-9 rounded-full" aria-label="Préférences et pauses" data-hint="Préférences de travail, rappels et pauses" onClick={() => setPrefsOpen(true)}><Settings2 className="h-4 w-4" aria-hidden /></Button>
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" aria-hidden /> Importer mon emploi du temps</Button>
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => setTaskEditor({ task: null })}><ClipboardPlus className="h-4 w-4" aria-hidden /> Tâche</Button>
          <Button className="gap-2 rounded-full" onClick={() => openCreate(now.date, 480)}><Plus className="h-4 w-4" aria-hidden /> Cours</Button>
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {view !== "list" && <div role="group" aria-label="Contenu affiché" className="flex flex-wrap gap-1 rounded-full border p-0.5">{CONTENTS.map((c) => <button key={c.id} type="button" aria-pressed={content === c.id} className={pill(content === c.id)} onClick={() => setContent(c.id)}>{c.label}</button>)}</div>}
        <select aria-label="Filtrer par type" className="h-8 rounded-full border bg-background px-3 text-xs" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">Tous les types</option>
          {Object.entries(TASK_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </div>

      {error && !data && (
        <div className="mt-6 rounded-3xl border p-8 text-center">
          <p className="typo-subtitle">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}>Réessayer</Button>
        </div>
      )}
      {!data && !error && <Skeleton className="mt-5 h-[600px] rounded-3xl" aria-busy />}

      {data && (view === "week" || view === "day") && (typeFilter || content !== "all") && days.every((d) => !coursesOn(d).length && !tasksOn(d).length && !specialsOn(d).length) && <p role="status" className="mt-4 rounded-2xl border p-4 text-center text-sm text-muted-foreground">Rien sur cette période pour ce filtre.</p>}

      {data && (view === "week" || view === "day") && (
        <>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className={cn("mt-4 overflow-x-auto rounded-3xl border bg-card p-3", view === "week" && "hidden md:block")}>
              <div style={{ minWidth: days.length === 1 ? undefined : 860 }}>
                <div className="grid gap-1 pb-2" style={{ gridTemplateColumns: columns }}>
                  <span className="pt-2 text-center text-xs text-muted-foreground">S{isoWeek(days[0])}</span>
                  {days.map((d) => {
                    const today = d === now.date;
                    return (
                      <div key={d} className="space-y-1">
                        <div className={cn("rounded-2xl py-2 text-center", today ? "bg-foreground text-background" : "bg-muted/50")} aria-current={today ? "date" : undefined}>
                          <p className="text-xs font-semibold uppercase tracking-wide">{DAY_NAMES[weekday(d) - 1]}</p>
                          <p className="tnum text-[11px] opacity-75">{formatDay(d, { day: "2-digit", month: "2-digit" })}</p>
                        </div>
                        {tasksOn(d).filter((t) => t.dueMinutes === null || t.dueMinutes < grid.start || t.dueMinutes > grid.end).map((t) => <TaskBadge key={t.id} t={t} onOpen={() => openTask(t)} />)}
                      </div>
                    );
                  })}
                </div>
                <div className="grid gap-x-1" style={{ gridTemplateColumns: columns }}>
                  <div className="relative" style={{ height: gridHeight }}>
                    {grid.marks.map((m) => <span key={m} className="tnum absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: slotBox({ startMinutes: m, endMinutes: m + 1 }, grid.start, PX_PER_HOUR).top }}>{formatMinutes(m)}</span>)}
                  </div>
                  {days.map((d) => <DayColumn key={d} date={d} items={coursesOn(d)} specials={specialsOn(d)} tasks={tasksOn(d)} sessions={sessionsOn(d)} breaks={data.breaks} grid={grid} height={gridHeight} now={now} onCreate={(s) => openCreate(d, s)} onOpen={openOccurrence} onOpenTask={openTask} />)}
                </div>
              </div>
            </div>
          </DndContext>

          {/* Téléphone : la semaine devient une journée à la fois */}
          {view === "week" && (
            <div className="mt-4 md:hidden">
              <div className="flex gap-1 overflow-x-auto pb-2" role="tablist" aria-label="Jours de la semaine">
                {days.map((d) => <button key={d} type="button" role="tab" aria-selected={d === anchor} onClick={() => setAnchor(d)} className={cn("min-w-12 flex-1 rounded-2xl py-2 text-center", d === anchor ? "bg-foreground text-background" : "bg-muted/60", d === now.date && d !== anchor && "ring-1 ring-foreground")}><span className="block text-[11px] font-semibold">{DAY_NAMES[weekday(d) - 1].slice(0, 3)}</span><span className="tnum text-xs">{formatDay(d, { day: "2-digit" })}</span></button>)}
              </div>
              <ul className="mt-2 space-y-2">
                {specialsOn(anchor).map((o) => <li key={o.key}><SpecialChip o={o} onOpen={() => openOccurrence(o)} /></li>)}
                {tasksOn(anchor).map((t) => <li key={t.id}><TaskBadge t={t} onOpen={() => openTask(t)} /></li>)}
                {coursesOn(anchor).length === 0 && !tasksOn(anchor).length && !specialsOn(anchor).length && <li className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">Rien de prévu ce jour-là.</li>}
                {coursesOn(anchor).map((o) => {
                  const state = classifyOccurrence(o, now.date, now.minutes);
                  return (
                    <li key={o.key}>
                      <button type="button" onClick={() => openOccurrence(o)} data-hint={courseHint(o)} className={cn("w-full rounded-2xl p-3 text-left", state === "past" && "opacity-55", state === "current" && "ring-2 ring-foreground")} style={{ background: `color-mix(in srgb, ${colorOf(o)} 34%, var(--card))` }}>
                        <span className="tnum text-xs opacity-75">{formatMinutes(o.startMinutes)} – {formatMinutes(o.endMinutes)}{o.sessionType ? ` · ${o.sessionType}` : ""}{state === "current" ? " · En cours" : ""}</span>
                        <span className="block font-semibold">{o.title}</span>
                        {(o.room || o.teacher) && <span className="block text-xs opacity-75">{[o.room, o.teacher].filter(Boolean).join(" · ")}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      {data && view === "month" && (
        <div className="mt-4 overflow-x-auto rounded-3xl border bg-card p-3">
          <div className="grid min-w-[720px] grid-cols-7 gap-1">
            {DAY_NAMES.map((d) => <p key={d} className="py-1 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.slice(0, 3)}</p>)}
            {Array.from({ length: 42 }, (_, i) => addDays(monthStart, i)).map((d) => {
              const courses = coursesOn(d);
              const out = d.slice(0, 7) !== anchor.slice(0, 7);
              return (
                <div key={d} onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) openDay(d); }} data-hint={courses.length ? courses.map((c) => `${formatMinutes(c.startMinutes)} ${c.title}`).join(" · ") : "Aucun cours"} data-hint-action="Voir cette journée" className={cn("min-h-24 cursor-pointer space-y-0.5 rounded-xl p-1 transition-colors hover:bg-muted", out ? "opacity-40" : "bg-muted/30", d === now.date && "ring-2 ring-foreground")}>
                  <button type="button" className="tnum px-1 text-xs font-semibold hover:underline" aria-label={`Voir le ${formatDay(d, { day: "numeric", month: "long" })}`} onClick={() => openDay(d)}>{Number(d.slice(8))}</button>
                  {specialsOn(d).slice(0, 1).map((o) => <SpecialChip key={o.key} o={o} onOpen={() => openOccurrence(o)} />)}
                  {tasksOn(d).slice(0, 3).map((t) => <TaskBadge key={t.id} t={t} compact onOpen={() => openTask(t)} />)}
                  {courses.length > 0 && <p className="px-1 text-[11px] text-muted-foreground">{courses.length} cours</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && view === "timeline" && (
        <ol className="mt-4 space-y-3">
          {timeline.filter((d) => coursesOn(d).length || tasksOn(d).length || specialsOn(d).length).map((d) => (
            <li key={d} className="rounded-2xl border bg-card p-3">
              <h2 className="text-sm font-semibold first-letter:uppercase">{formatDay(d, { weekday: "long", day: "numeric", month: "long" })}</h2>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {specialsOn(d).map((o) => <SpecialChip key={o.key} o={o} onOpen={() => openOccurrence(o)} />)}
                {tasksOn(d).map((t) => <TaskBadge key={t.id} t={t} onOpen={() => openTask(t)} />)}
                {coursesOn(d).map((o) => <button key={o.key} type="button" onClick={() => openOccurrence(o)} data-hint={courseHint(o)} data-hint-action="Voir les détails" className="truncate rounded-lg px-2 py-1 text-left text-xs" style={{ background: `color-mix(in srgb, ${colorOf(o)} 34%, var(--card))` }}><span className="tnum opacity-70">{formatMinutes(o.startMinutes)}</span> <span className="font-medium">{o.title}</span></button>)}
              </div>
            </li>
          ))}
          {!timeline.some((d) => coursesOn(d).length || tasksOn(d).length || specialsOn(d).length) && <li className="rounded-2xl border p-8 text-center text-sm text-muted-foreground"><CalendarPlus className="mx-auto mb-2 h-5 w-5" aria-hidden /> Rien sur les 31 prochains jours.</li>}
        </ol>
      )}

      {data && view === "list" && <div className="mt-4"><TaskList tasks={visibleTasks} onOpen={openTask} onStatus={(t, s) => void setStatus(t, s)} /></div>}

      {editor && data && <EventDialog key={editor.mode === "edit" ? editor.occurrence.key : "create"} state={editor} subjects={data.subjects} onClose={() => setEditor(null)} onSubmit={submit} onDelete={remove} onDuplicate={duplicate} onSubjectCreated={addSubject} />}
      {taskEditor && data && <TaskDialog key={taskEditor.task?.id ?? `new-${taskEditor.draft?.parentId ?? ""}`} task={taskEditor.task} draft={taskEditor.draft} subjects={data.subjects} onClose={() => setTaskEditor(null)} onSaved={() => { setTaskEditor(null); void load(); }} onPlan={(t) => { setTaskEditor(null); setPlanning(t); }} onAddStep={(t) => setTaskEditor({ task: null, draft: { parentId: t.id, subjectId: t.subjectId, type: "PROJET", dueDate: t.dueDate } })} />}
      {planning && <PlanDialog task={planning} onClose={() => setPlanning(null)} onSaved={() => { setPlanning(null); void load(); }} />}
      {prefsOpen && <PrefsDialog onClose={() => setPrefsOpen(false)} onSaved={() => void load()} />}
      {importing && <ImportDialog weekStart={weekStart} onClose={() => setImporting(false)} onDone={() => { setImporting(false); void load(); }} />}
      {askScope && (
        <Dialog open onOpenChange={(v) => !v && setAskScope(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Déplacer « {askScope.title} »</DialogTitle>
              <DialogDescription>Ce cours a plusieurs séances.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button onClick={() => { const a = askScope; setAskScope(null); void a.apply("occurrence"); }}>Cette séance uniquement</Button>
              <Button variant="outline" onClick={() => { const a = askScope; setAskScope(null); void a.apply("all"); }}>Toute la série</Button>
              <Button variant="ghost" onClick={() => setAskScope(null)}>Annuler</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
