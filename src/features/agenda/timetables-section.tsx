"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Section « Emplois du temps » : uniquement les cours, les pauses et les plages horaires. Plusieurs emplois du temps
// (importés ou créés à la main) ; l'étudiant choisit celui qu'il suit. Les heures ne sont jamais imposées : la grille,
// les créneaux et la structure de chaque journée viennent des cours et des pauses de l'emploi du temps lui-même.
// L'ajout, la modification et la suppression des cours se font ici, en mode « Modifier ».
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { Briefcase, Calendar, CalendarDays, CalendarPlus, CalendarRange, Check, ChevronLeft, ChevronRight, Coffee, FilePlus2, FileUp, GraduationCap, MapPin, Palmtree, Pencil, Plus, Repeat, Rows3, Settings2, Trash2, TriangleAlert, User, X, type LucideIcon } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { confirmAction, notify } from "@/components/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedState } from "@/hooks/use-cached-state";
import { announceDataChanged, useBackgroundRefresh } from "@/hooks/use-background-refresh";
import { addDays, classifyOccurrence, computeGrid, formatMinutes, isoWeek, mondayOf, slotBox, weekLetter, weekday, type GridGeometry } from "@/server/domain/schedule";
import { dayStructure, timeSlots } from "@/server/domain/day-structure";
import { useModuleToolbar } from "@/components/layout/floating-toolbar";
import { EventDialog, type EditorState, type EventValues } from "./event-dialog";
import { ImportDialog } from "./import-dialog";
import { DAY_NAMES, colorOf, courseHint, formatDay, fromTimeInput, localClock, toTimeInput, type AgendaData, type BreakDto, type OccurrenceDto, type Scope, type SubjectOption } from "./types";

const PX_PER_HOUR = 64;
const SNAP = 15;
type View = "week" | "day" | "month" | "timeline";

const VIEWS: { id: View; label: string; icon: LucideIcon; color: string }[] = [
  { id: "week", label: "Semaine", icon: CalendarRange, color: "var(--accent-sky)" },
  { id: "day", label: "Jour", icon: CalendarDays, color: "var(--accent-sun)" },
  { id: "month", label: "Mois", icon: Calendar, color: "var(--accent-mint)" },
  { id: "timeline", label: "Chronologie", icon: Rows3, color: "var(--accent-lilac)" },
];

interface Timetable { id: string; label: string; fileName: string; source: string; createdAt: string; _count: { events: number; breaks: number } }
interface TimetablesData { imports: Timetable[]; activeId: string | null }
export const TIMETABLES_KEY = ["agenda-timetables"] as const;

const errText = (e: unknown, fb: string) => (e instanceof Error && e.message ? e.message : fb);

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

function CourseCard({ o, state, lane, lanes, clash, grid, editing, onOpen }: { o: OccurrenceDto; state: "past" | "current" | "upcoming"; lane: number; lanes: number; clash: boolean; grid: GridGeometry; editing: boolean; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: o.key, data: { occurrence: o }, disabled: !editing });
  const color = colorOf(o);
  const box = slotBox(o, grid.start, PX_PER_HOUR);
  const short = box.height < 52;
  const tall = box.height >= 92;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...(editing ? listeners : {})}
      {...attributes}
      onClick={onOpen}
      data-hint={courseHint(o)}
      data-hint-action={editing ? "Modifier ce cours" : "Voir les détails"}
      aria-label={`${courseHint(o)}${state === "current" ? ", en cours" : ""}`}
      style={{ top: box.top + 1, height: Math.max(18, box.height - 2), left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, background: `color-mix(in srgb, ${color} 34%, var(--card))`, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined, zIndex: isDragging ? 30 : 2 }}
      className={cn("absolute overflow-hidden rounded-2xl p-2 text-left text-xs leading-tight text-foreground transition-shadow hover:shadow-md", editing ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-pointer", state === "past" && "opacity-55", state === "current" && "ring-2 ring-foreground", clash && "outline outline-2 outline-amber-500", isDragging && "shadow-xl")}
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

function DayColumn(props: { date: string; items: OccurrenceDto[]; specials: OccurrenceDto[]; breaks: BreakDto[]; grid: GridGeometry; height: number; now: { date: string; minutes: number }; editing: boolean; onCreate: (start: number) => void; onOpen: (o: OccurrenceDto) => void }) {
  const { date, items, specials, breaks, grid, height, now, editing, onCreate, onOpen } = props;
  const { setNodeRef, isOver } = useDroppable({ id: date });
  const today = date === now.date;
  return (
    <div
      ref={setNodeRef}
      role="presentation"
      className={cn("relative border-l border-border/60", today && "bg-muted/40", isOver && "bg-primary/5", editing && "cursor-copy")}
      style={{ height }}
      onClick={(e) => {
        if (!editing || e.target !== e.currentTarget) return;
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        onCreate(grid.start + Math.floor(((y / PX_PER_HOUR) * 60) / SNAP) * SNAP);
      }}
    >
      {breaksOn(date, breaks).filter((b) => b.startMinutes >= grid.start && b.endMinutes <= grid.end).map((b) => {
        const box = slotBox(b, grid.start, PX_PER_HOUR);
        return (
          <div key={b.id} data-hint={`${b.label} · ${formatMinutes(b.startMinutes)} – ${formatMinutes(b.endMinutes)}`} className="niala-break pointer-events-none absolute inset-x-0 flex items-center justify-center overflow-hidden" style={{ top: box.top, height: box.height }}>
            {box.height >= 16 && <span className="truncate rounded-full bg-background/80 px-1.5 text-[10px] text-muted-foreground">{b.label}</span>}
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
      {layoutLanes(items).map(({ o, lane, lanes, clash }) => <CourseCard key={o.key} o={o} lane={lane} lanes={lanes} clash={clash} grid={grid} editing={editing} state={classifyOccurrence(o, now.date, now.minutes)} onOpen={() => onOpen(o)} />)}
      {today && now.minutes >= grid.start && now.minutes <= grid.end && (
        <div className="pointer-events-none absolute inset-x-0 z-20 h-px bg-foreground" style={{ top: slotBox({ startMinutes: now.minutes, endMinutes: now.minutes + 1 }, grid.start, PX_PER_HOUR).top }} aria-hidden>
          <span className="niala-pointer-right absolute -left-1 -top-[5px]" />
        </div>
      )}
    </div>
  );
}

// ── Emplois du temps : liste, création, renommage, suppression ──────────────

function NewTimetableDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ schedule: { id: string } }>("/api/agenda/schedules", { label, activate: true });
      notify({ title: "Emploi du temps créé", description: "Ajoutez maintenant vos cours, pauses et plages horaires.", variant: "success" });
      onCreated(r.schedule.id);
    } catch (err) {
      setError(errText(err, "Création impossible."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Créer un emploi du temps</DialogTitle>
            <DialogDescription>Un emploi du temps vide : vous y placez vous-même vos cours, pauses et plages horaires, aux heures de votre établissement.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="tt-name">Nom</Label>
            <Input id="tt-name" autoFocus required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Semestre 2 — L3 Informatique" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={busy || !label.trim()}>Créer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Pauses et plages horaires d'un emploi du temps ──────────────────────────

function BreaksEditor({ scheduleId, breaks, onChanged }: { scheduleId: string; breaks: BreakDto[]; onChanged: () => void }) {
  const [label, setLabel] = useState("Pause");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [day, setDay] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string; start: string; end: string; day: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const s = fromTimeInput(start);
    const en = fromTimeInput(end);
    if (s === null || en === null) return setError("Indiquez l'heure de début et de fin.");
    try {
      await api.post("/api/agenda/breaks", { scheduleId, label: label.trim() || "Pause", startMinutes: s, endMinutes: en, weekday: day ? Number(day) : null });
      setStart("");
      setEnd("");
      setError(null);
      onChanged();
    } catch (err) {
      setError(errText(err, "Ajout impossible."));
    }
  }
  async function save() {
    if (!editing) return;
    const s = fromTimeInput(editing.start);
    const en = fromTimeInput(editing.end);
    if (s === null || en === null) return setError("Heures invalides.");
    try {
      await api.patch(`/api/agenda/breaks/${editing.id}`, { label: editing.label.trim() || "Pause", startMinutes: s, endMinutes: en, weekday: editing.day ? Number(editing.day) : null });
      setEditing(null);
      setError(null);
      onChanged();
    } catch (err) {
      setError(errText(err, "Modification impossible."));
    }
  }
  async function remove(b: BreakDto) {
    if (!(await confirmAction(`Supprimer « ${b.label} » (${formatMinutes(b.startMinutes)} – ${formatMinutes(b.endMinutes)}) ?`, { confirmLabel: "Supprimer" }))) return;
    await api.del(`/api/agenda/breaks/${b.id}`).catch((err) => notify({ title: "Suppression impossible", description: errText(err, ""), variant: "error" }));
    onChanged();
  }
  const select = "h-9 rounded-md border bg-background px-2 text-sm";
  return (
    <div className="space-y-3">
      {breaks.length === 0 ? <p className="typo-meta">Aucune pause ni plage pour l&apos;instant. Ajoutez par exemple la pause de midi, une récréation ou une plage réservée.</p> : (
        <ul className="space-y-1.5">
          {breaks.map((b) => editing?.id === b.id ? (
            <li key={b.id} className="flex flex-wrap items-end gap-2 rounded-xl border p-2">
              <Input aria-label="Nom" className="h-9 w-36" value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
              <Input aria-label="Début" type="time" className="h-9 w-28" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} />
              <Input aria-label="Fin" type="time" className="h-9 w-28" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} />
              <select aria-label="Jour" className={select} value={editing.day} onChange={(e) => setEditing({ ...editing, day: e.target.value })}><option value="">Tous les jours</option>{DAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>
              <Button size="sm" onClick={() => void save()}>Enregistrer</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Annuler</Button>
            </li>
          ) : (
            <li key={b.id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm">
              <Coffee className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate"><span className="font-medium">{b.label}</span> · <span className="tnum">{formatMinutes(b.startMinutes)} – {formatMinutes(b.endMinutes)}</span> · {b.weekday ? DAY_NAMES[b.weekday - 1] : "tous les jours"}</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Modifier ${b.label}`} onClick={() => setEditing({ id: b.id, label: b.label, start: toTimeInput(b.startMinutes), end: toTimeInput(b.endMinutes), day: b.weekday ? String(b.weekday) : "" })}><Pencil className="h-4 w-4" aria-hidden /></Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`Supprimer ${b.label}`} onClick={() => void remove(b)}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor="br-label" className="text-xs">Pause ou plage</Label><Input id="br-label" className="h-9 w-36" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="br-start" className="text-xs">Début</Label><Input id="br-start" type="time" className="h-9 w-28" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="br-end" className="text-xs">Fin</Label><Input id="br-end" type="time" className="h-9 w-28" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="br-day" className="text-xs">Jour</Label><select id="br-day" className={select} value={day} onChange={(e) => setDay(e.target.value)}><option value="">Tous les jours</option>{DAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>
        <Button type="submit" size="sm" variant="outline" className="h-9 gap-1.5"><Plus className="h-4 w-4" aria-hidden /> Ajouter</Button>
      </form>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Créneaux et structure de la journée, déduits de l'emploi du temps (aucun horaire prédéfini). */
function StructurePanel({ data, days, anchor }: { data: AgendaData; days: string[]; anchor: string }) {
  const courses = data.occurrences.filter((o) => !o.allDay && days.includes(o.date));
  const slots = timeSlots(courses);
  const day = days.includes(anchor) ? anchor : days[0];
  const segments = dayStructure(courses.filter((o) => o.date === day), breaksOn(day, data.breaks));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="text-sm font-semibold">Créneaux horaires de la période</h3>
        <p className="typo-meta">Lus dans vos cours : ils suivent les horaires de votre établissement.</p>
        {slots.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">{slots.map((s) => <li key={`${s.startMinutes}-${s.endMinutes}`} className="tnum rounded-full border px-2.5 py-1 text-xs">{formatMinutes(s.startMinutes)} – {formatMinutes(s.endMinutes)} <span className="text-muted-foreground">· {s.count} cours</span></li>)}</ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">Aucun cours sur cette période.</p>}
      </div>
      <div>
        <h3 className="text-sm font-semibold first-letter:uppercase">{formatDay(day, { weekday: "long", day: "numeric", month: "long" })}</h3>
        <p className="typo-meta">Cours, pauses et périodes libres, dans l&apos;ordre de la journée.</p>
        {segments.length ? (
          <ol className="mt-2 space-y-1">
            {segments.map((s, i) => (
              <li key={i} className={cn("flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs", s.kind === "course" && "bg-primary/10", s.kind === "break" && "niala-break", s.kind === "free" && "border border-dashed")}>
                <span className="tnum w-24 shrink-0 font-medium">{formatMinutes(s.startMinutes)} – {formatMinutes(s.endMinutes)}</span>
                <span className="truncate">{s.kind === "free" ? `Libre (${s.endMinutes - s.startMinutes} min)` : s.labels.join(" · ")}</span>
              </li>
            ))}
          </ol>
        ) : <p className="mt-2 text-sm text-muted-foreground">Rien ce jour-là.</p>}
      </div>
    </div>
  );
}

// ── Section principale ───────────────────────────────────────────────────────

/** `importRequest` : compteur incrémenté quand un autre module demande d'importer un emploi du temps. */
export function TimetablesSection({ importRequest }: { importRequest: number }) {
  const qc = useQueryClient();
  const { data: list, refetch: refetchList } = useQuery({ queryKey: TIMETABLES_KEY, queryFn: () => api.get<TimetablesData>("/api/agenda/imports") });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const timetables = useMemo(() => list?.imports ?? [], [list]);
  const selected = timetables.find((t) => t.id === selectedId) ?? timetables.find((t) => t.id === list?.activeId) ?? timetables[0] ?? null;
  const [now, setNow] = useState(localClock);
  const [anchor, setAnchor] = useState(() => localClock().date);
  const [view, setView] = useState<View>("week");
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<"none" | "breaks" | "structure">("none");
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [askScope, setAskScope] = useState<{ title: string; apply: (s: Scope) => Promise<void> } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [seenImport, setSeenImport] = useState(0);
  if (importRequest !== seenImport) {
    setSeenImport(importRequest);
    if (importRequest > 0) setImporting(true);
  }

  const weekStart = mondayOf(anchor);
  const monthStart = mondayOf(`${anchor.slice(0, 8)}01`);
  const range = useMemo(() => {
    if (view === "month") return [monthStart, addDays(monthStart, 41)] as const;
    if (view === "timeline") return [weekStart, addDays(weekStart, 30)] as const;
    return [weekStart, addDays(weekStart, 6)] as const;
  }, [view, monthStart, weekStart]);
  const [data, setData] = useCachedState<AgendaData | null>(["timetable", selected?.id ?? "", range[0], range[1]], null);
  const days = useMemo(() => (view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))), [view, anchor, weekStart]);

  const load = useCallback(async () => {
    if (!selected) return;
    try {
      setData(await api.get<AgendaData>(`/api/agenda?from=${range[0]}&to=${range[1]}&scheduleId=${selected.id}`));
      setError(null);
    } catch (e) {
      setError(errText(e, "Chargement impossible."));
    }
  }, [range, selected, setData]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(localClock()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Après une modification : relecture ici, et signal aux autres onglets ouverts de Niala.
  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: TIMETABLES_KEY });
    void load();
    announceDataChanged("agenda");
  };
  // En arrière-plan (retour sur l'onglet, réseau, toutes les minutes, autre onglet) ; suspendu pendant une saisie.
  const backgroundRefresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: TIMETABLES_KEY });
    return load();
  }, [qc, load]);
  useBackgroundRefresh(backgroundRefresh, { topics: ["agenda"], enabled: !editor && !askScope && !renaming && !importing && !creating });

  const coursesOn = (date: string) => (data?.occurrences ?? []).filter((o) => o.date === date && !o.allDay);
  const specialsOn = (date: string) => (data?.occurrences ?? []).filter((o) => o.date === date && o.allDay);
  const grid = useMemo(() => {
    const occ = (data?.occurrences ?? []).filter((o) => days.includes(o.date) && (!o.allDay || o.endMinutes < 1440));
    const relevant = (data?.breaks ?? []).filter((b) => days.some((d) => b.weekday === null || b.weekday === weekday(d)));
    return computeGrid(occ, relevant);
  }, [days, data]);
  const gridHeight = slotBox({ startMinutes: grid.start, endMinutes: grid.end }, grid.start, PX_PER_HOUR).height;
  const columns = `60px repeat(${days.length}, minmax(${days.length === 1 ? 240 : 112}px, 1fr))`;
  const timeline = useMemo(() => Array.from({ length: 31 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  useModuleToolbar(VIEWS.map((v) => ({ label: v.label, icon: v.icon, color: v.color, active: view === v.id, onClick: () => setView(v.id) })));

  async function follow(id: string) {
    try {
      await api.patch("/api/agenda/settings", { activeScheduleId: id });
      qc.setQueryData<TimetablesData>(TIMETABLES_KEY, (d) => (d ? { ...d, activeId: id } : d));
      notify({ title: "Emploi du temps suivi", description: "Il sert aux rappels de cours et au tableau de bord.", variant: "success", durationMs: 3000 });
    } catch (e) {
      notify({ title: "Changement impossible", description: errText(e, ""), variant: "error" });
    }
  }
  async function rename(t: Timetable, label: string) {
    try {
      await api.patch(`/api/agenda/imports/${t.id}`, { label });
      setRenaming(null);
      await refetchList();
    } catch (e) {
      notify({ title: "Renommage impossible", description: errText(e, ""), variant: "error" });
    }
  }
  async function removeTimetable(t: Timetable) {
    const ok = await confirmAction(`Supprimer l'emploi du temps « ${t.label} », ses ${t._count.events} cours et ses ${t._count.breaks} pauses ? Vos autres emplois du temps et vos tâches sont conservés. Cette action est irréversible.`, { title: "Supprimer un emploi du temps", confirmLabel: "Supprimer", danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/agenda/imports/${t.id}`);
      setSelectedId(null);
      setEditing(false);
      refreshAll();
      notify({ title: "Emploi du temps supprimé", variant: "success" });
    } catch (e) {
      notify({ title: "Suppression impossible", description: errText(e, ""), variant: "error" });
    }
  }

  async function patchEvent(o: OccurrenceDto, values: Partial<EventValues>, scope: Scope) {
    const saved = await withConfirm((force) => api.patch(`/api/agenda/events/${o.eventId}`, { ...values, scope, occurrenceDate: o.originalDate, force }));
    if (saved) {
      notify({ title: "Emploi du temps mis à jour", variant: "success" });
      refreshAll();
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
        notify({ title: "Déplacement impossible", description: errText(err, ""), variant: "error" });
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
    const saved = await withConfirm((force) => api.post("/api/agenda/events", { ...values, title: values.title || undefined, scheduleId: selected?.id, force }));
    if (saved) {
      notify({ title: "Cours ajouté à l'emploi du temps", variant: "success" });
      setEditor(null);
      refreshAll();
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
    refreshAll();
  }
  async function duplicate() {
    if (editor?.mode !== "edit") return;
    const o = editor.occurrence;
    const saved = await withConfirm((force) => api.post("/api/agenda/events", { title: o.title, subjectId: o.subjectId, kind: o.kind, date: addDays(o.date, 1), startMinutes: o.startMinutes, endMinutes: o.endMinutes, recurrence: o.recurrence === "WEEKLY" ? "WEEKLY" : "NONE", until: o.until, weekPattern: o.weekPattern, room: o.room, teacher: o.teacher, groupName: o.groupName, description: o.description, sessionType: o.sessionType, code: o.code, scheduleId: selected?.id, force }));
    if (saved) {
      notify({ title: "Cours dupliqué", description: "La copie est placée le lendemain : déplacez-la si besoin.", variant: "success" });
      setEditor(null);
      refreshAll();
    }
  }
  async function toggleWeekSwap() {
    if (!data) return;
    await api.patch("/api/agenda/settings", { weekSwap: !data.weekSwap });
    await load();
  }

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
  const openDay = (date: string) => {
    setAnchor(date);
    setView("day");
  };

  // ── Aucun emploi du temps : import ou création ─────────────────────────────
  if (list && timetables.length === 0) {
    return (
      <>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <button type="button" onClick={() => setImporting(true)} className="rounded-3xl border bg-card p-6 text-left transition-colors hover:bg-muted/50">
            <FileUp className="h-6 w-6" aria-hidden />
            <p className="mt-3 font-semibold">Importer un emploi du temps</p>
            <p className="typo-meta mt-1">PDF, image, Word, Excel ou CSV. Niala lit les cours, leurs horaires et les pauses ; vous vérifiez avant d&apos;enregistrer.</p>
          </button>
          <button type="button" onClick={() => setCreating(true)} className="rounded-3xl border bg-card p-6 text-left transition-colors hover:bg-muted/50">
            <FilePlus2 className="h-6 w-6" aria-hidden />
            <p className="mt-3 font-semibold">Créer un emploi du temps</p>
            <p className="typo-meta mt-1">Partez de zéro et placez vos cours et vos pauses aux heures de votre établissement.</p>
          </button>
        </div>
        {importing && <ImportDialog weekStart={weekStart} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refreshAll(); }} />}
        {creating && <NewTimetableDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); setEditing(true); refreshAll(); }} />}
      </>
    );
  }

  return (
    <>
      {/* Barre des emplois du temps */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Mes emplois du temps" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 pb-1">
          {!list && <Skeleton className="h-9 w-48 rounded-full" />}
          {timetables.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={selected?.id === t.id} onClick={() => { setSelectedId(t.id); setEditing(false); }} className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors", selected?.id === t.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted")}>
              {t.label}
              {list?.activeId === t.id && <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold", selected?.id === t.id ? "bg-background/20" : "bg-primary/15 text-primary")}><Check className="h-3 w-3" aria-hidden /> suivi</span>}
            </button>
          ))}
        </div>
        {selected && (
          <>
            <Button size="sm" variant={editing ? "default" : "outline"} className="gap-1.5 rounded-full" aria-pressed={editing} onClick={() => setEditing((v) => !v)}><Pencil className="h-4 w-4" aria-hidden /> {editing ? "Terminer" : "Modifier"}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" aria-label={`Réglages de « ${selected.label} »`} data-hint="Réglages de l'emploi du temps"><Settings2 className="h-4 w-4" aria-hidden /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate font-semibold">{selected.label}</span>
                  <span className="block text-xs text-muted-foreground">{selected.source === "MANUAL" ? "Créé à la main" : `Importé depuis « ${selected.fileName} »`} · {selected._count.events} cours · {selected._count.breaks} pause{selected._count.breaks > 1 ? "s" : ""}{list?.activeId === selected.id ? " · suivi" : ""}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {list?.activeId !== selected.id && <DropdownMenuItem onSelect={() => void follow(selected.id)}><Check className="h-4 w-4" aria-hidden /> Suivre cet emploi du temps</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setPanel("structure")}><Rows3 className="h-4 w-4" aria-hidden /> Créneaux et structure de la journée</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("breaks")}><Coffee className="h-4 w-4" aria-hidden /> Pauses et plages</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenaming(selected.id)}><Pencil className="h-4 w-4" aria-hidden /> Renommer</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void removeTimetable(selected)}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
        <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" aria-hidden /> Importer</Button>
        <Button variant="outline" size="sm" className="gap-1.5 rounded-full" onClick={() => setCreating(true)}><FilePlus2 className="h-4 w-4" aria-hidden /> Créer</Button>
      </div>

      {/* Renommage, mode modification et panneaux : affichés seulement quand ils sont ouverts. */}
      {selected && renaming === selected.id && (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get("label"); void rename(selected, String(v ?? "")); }}>
          <Input name="label" aria-label="Nom de l'emploi du temps" defaultValue={selected.label} maxLength={80} className="h-9 w-64" autoFocus />
          <Button type="submit" size="sm">Enregistrer</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>Annuler</Button>
        </form>
      )}
      {selected && editing && (
        <div role="status" className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-primary/8 p-3 text-sm">
          <span className="min-w-0 flex-1">Mode modification : cliquez sur un créneau vide pour ajouter un cours, sur un cours pour le modifier ou le supprimer, ou faites-le glisser pour le déplacer.</span>
          <Button size="sm" className="gap-1.5" onClick={() => openCreate(view === "day" ? anchor : days.includes(now.date) ? now.date : days[0], 480)}><CalendarPlus className="h-4 w-4" aria-hidden /> Nouveau cours</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPanel(panel === "breaks" ? "none" : "breaks")}><Coffee className="h-4 w-4" aria-hidden /> Pauses et plages</Button>
        </div>
      )}
      {selected && panel !== "none" && data && (
        <div className="mt-3 rounded-3xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{panel === "breaks" ? `Pauses et plages · ${selected.label}` : `Créneaux et structure de la journée · ${selected.label}`}</h2>
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Fermer le panneau" onClick={() => setPanel("none")}><X className="h-4 w-4" aria-hidden /></Button>
          </div>
          {panel === "breaks" ? <BreaksEditor scheduleId={selected.id} breaks={data.breaks} onChanged={refreshAll} /> : <StructurePanel data={data} days={view === "day" ? [anchor] : days} anchor={anchor} />}
        </div>
      )}

      {/* Navigation dans le temps */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-full border p-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={`Période précédente : ${periodLabel(step(-1))}`} onClick={() => setAnchor(step(-1))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <span className="tnum min-w-28 px-1 text-center text-sm font-medium first-letter:uppercase" aria-live="polite">{periodLabel(anchor)}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label={`Période suivante : ${periodLabel(step(1))}`} onClick={() => setAnchor(step(1))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </div>
        <Button variant="ghost" size="sm" className="h-7 rounded-full border px-2.5 text-xs" onClick={() => setAnchor(now.date)}>Aujourd&apos;hui</Button>
        {data && view === "week" && <button type="button" data-hint="Inverser semaines A et B selon votre établissement" className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted" onClick={() => void toggleWeekSwap()}>Semaine {weekLetter(weekStart, data.weekSwap)} · S{isoWeek(weekStart)}</button>}
        <div role="group" aria-label="Affichage" className="ml-auto hidden gap-1 rounded-full border p-0.5 sm:flex">
          {VIEWS.map((v) => <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)} className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors", view === v.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>{v.label}</button>)}
        </div>
      </div>

      {error && !data && (
        <div className="mt-6 rounded-3xl border p-8 text-center">
          <p className="typo-subtitle">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}>Réessayer</Button>
        </div>
      )}
      {!data && !error && <Skeleton className="mt-5 h-[600px] rounded-3xl" aria-busy />}

      {data && (view === "week" || view === "day") && (
        <>
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className={cn("mt-4 overflow-x-auto rounded-3xl border bg-card p-3", view === "week" && "hidden md:block", editing && "ring-2 ring-primary/40")}>
              <div style={{ minWidth: days.length === 1 ? undefined : 860 }}>
                <div className="grid gap-1 pb-2" style={{ gridTemplateColumns: columns }}>
                  <span className="pt-2 text-center text-xs text-muted-foreground">S{isoWeek(days[0])}</span>
                  {days.map((d) => (
                    <div key={d} className={cn("rounded-2xl py-2 text-center", d === now.date ? "bg-foreground text-background" : "bg-muted/50")} aria-current={d === now.date ? "date" : undefined}>
                      <p className="text-xs font-semibold uppercase tracking-wide">{DAY_NAMES[weekday(d) - 1]}</p>
                      <p className="tnum text-[11px] opacity-75">{formatDay(d, { day: "2-digit", month: "2-digit" })}</p>
                    </div>
                  ))}
                </div>
                <div className="grid gap-x-1" style={{ gridTemplateColumns: columns }}>
                  <div className="relative" style={{ height: gridHeight }}>
                    {grid.marks.map((m) => <span key={m} className="tnum absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: slotBox({ startMinutes: m, endMinutes: m + 1 }, grid.start, PX_PER_HOUR).top }}>{formatMinutes(m)}</span>)}
                  </div>
                  {days.map((d) => <DayColumn key={d} date={d} items={coursesOn(d)} specials={specialsOn(d)} breaks={data.breaks} grid={grid} height={gridHeight} now={now} editing={editing} onCreate={(s) => openCreate(d, s)} onOpen={openOccurrence} />)}
                </div>
              </div>
            </div>
          </DndContext>
          {data.occurrences.length === 0 && <p role="status" className="mt-3 rounded-2xl border p-4 text-center text-sm text-muted-foreground">{editing ? "Cliquez sur la grille ou sur « Nouveau cours » pour ajouter vos cours." : "Aucun cours sur cette période. Utilisez « Modifier » pour en ajouter."}</p>}

          {/* Téléphone : la semaine devient une journée à la fois */}
          {view === "week" && (
            <div className="mt-4 md:hidden">
              <div className="flex gap-1 overflow-x-auto pb-2" role="tablist" aria-label="Jours de la semaine">
                {days.map((d) => <button key={d} type="button" role="tab" aria-selected={d === anchor} onClick={() => setAnchor(d)} className={cn("min-w-12 flex-1 rounded-2xl py-2 text-center", d === anchor ? "bg-foreground text-background" : "bg-muted/60", d === now.date && d !== anchor && "ring-1 ring-foreground")}><span className="block text-[11px] font-semibold">{DAY_NAMES[weekday(d) - 1].slice(0, 3)}</span><span className="tnum text-xs">{formatDay(d, { day: "2-digit" })}</span></button>)}
              </div>
              <ul className="mt-2 space-y-2">
                {specialsOn(anchor).map((o) => <li key={o.key}><SpecialChip o={o} onOpen={() => openOccurrence(o)} /></li>)}
                {dayStructure(coursesOn(anchor), breaksOn(anchor, data.breaks)).filter((s) => s.kind !== "course").length === 0 && coursesOn(anchor).length === 0 && !specialsOn(anchor).length && <li className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">Rien de prévu ce jour-là.</li>}
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
                {breaksOn(anchor, data.breaks).map((b) => <li key={b.id} className="niala-break rounded-2xl px-3 py-2 text-xs"><span className="tnum font-medium">{formatMinutes(b.startMinutes)} – {formatMinutes(b.endMinutes)}</span> · {b.label}</li>)}
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
                  {courses.length > 0 && <p className="px-1 text-[11px] text-muted-foreground">{courses.length} cours</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && view === "timeline" && (
        <ol className="mt-4 space-y-3">
          {timeline.filter((d) => coursesOn(d).length || specialsOn(d).length).map((d) => (
            <li key={d} className="rounded-2xl border bg-card p-3">
              <h3 className="text-sm font-semibold first-letter:uppercase">{formatDay(d, { weekday: "long", day: "numeric", month: "long" })}</h3>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {specialsOn(d).map((o) => <SpecialChip key={o.key} o={o} onOpen={() => openOccurrence(o)} />)}
                {coursesOn(d).map((o) => <button key={o.key} type="button" onClick={() => openOccurrence(o)} data-hint={courseHint(o)} className="truncate rounded-lg px-2 py-1 text-left text-xs" style={{ background: `color-mix(in srgb, ${colorOf(o)} 34%, var(--card))` }}><span className="tnum opacity-70">{formatMinutes(o.startMinutes)}</span> <span className="font-medium">{o.title}</span></button>)}
              </div>
            </li>
          ))}
          {!timeline.some((d) => coursesOn(d).length || specialsOn(d).length) && <li className="rounded-2xl border p-8 text-center text-sm text-muted-foreground"><CalendarPlus className="mx-auto mb-2 h-5 w-5" aria-hidden /> Aucun cours sur les 31 prochains jours.</li>}
        </ol>
      )}

      {editor && data && <EventDialog key={editor.mode === "edit" ? editor.occurrence.key : "create"} state={editor} subjects={data.subjects} onClose={() => setEditor(null)} onSubmit={submit} onDelete={remove} onDuplicate={duplicate} onSubjectCreated={addSubject} />}
      {importing && <ImportDialog weekStart={weekStart} target={selected ? { id: selected.id, label: selected.label } : null} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setSelectedId(null); refreshAll(); }} />}
      {creating && <NewTimetableDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); setEditing(true); refreshAll(); }} />}
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
    </>
  );
}
