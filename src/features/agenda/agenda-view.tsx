"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, CalendarPlus, FileUp, MapPin, Plus, Repeat, TriangleAlert, User } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { confirmAction, notify } from "@/components/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { BREAKS, DAY_END, DAY_START, TIME_MARKS, addDays, classifyOccurrence, formatMinutes, isoWeek, mondayOf, weekLetter, weekday } from "@/server/domain/schedule";
import { EventDialog, type EditorState, type EventValues } from "./event-dialog";
import { ImportDialog } from "./import-dialog";
import { DAY_NAMES, colorOf, formatDay, localClock, type AgendaData, type OccurrenceDto, type Scope, type SubjectOption } from "./types";

const PX_PER_MIN = 1.25;
const SNAP = 15;
const yOf = (m: number) => (m - DAY_START) * PX_PER_MIN;
const GRID_HEIGHT = yOf(DAY_END);

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

/** Place côte à côte les séances qui se chevauchent (cas accepté par l'étudiant). */
function layoutLanes(items: OccurrenceDto[]) {
  const ends: number[] = [];
  const placed = items.map((o) => {
    let lane = ends.findIndex((e) => e <= o.startMinutes);
    if (lane < 0) lane = ends.length;
    ends[lane] = o.endMinutes;
    return { o, lane };
  });
  return placed.map((p) => ({ ...p, lanes: Math.max(1, ...placed.filter((x) => x.o.startMinutes < p.o.endMinutes && p.o.startMinutes < x.o.endMinutes).map((x) => x.lane + 1)) }));
}

function CourseCard({ o, state, lane, lanes, onOpen }: { o: OccurrenceDto; state: "past" | "current" | "upcoming"; lane: number; lanes: number; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: o.key, data: { occurrence: o } });
  const color = colorOf(o);
  const compact = o.endMinutes - o.startMinutes < 50;
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={onOpen}
      aria-label={`${o.title}, ${formatMinutes(o.startMinutes)} à ${formatMinutes(o.endMinutes)}${state === "current" ? ", en cours" : ""}`}
      style={{
        top: yOf(o.startMinutes) + 1,
        height: (o.endMinutes - o.startMinutes) * PX_PER_MIN - 2,
        left: `calc(${(lane / lanes) * 100}% + 2px)`,
        width: `calc(${100 / lanes}% - 4px)`,
        background: `color-mix(in srgb, ${color} 30%, var(--card))`,
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        zIndex: isDragging ? 30 : 2,
      }}
      className={cn(
        "absolute cursor-grab touch-none overflow-hidden rounded-2xl p-2 text-left text-[11px] leading-tight text-foreground transition-shadow hover:shadow-md active:cursor-grabbing",
        state === "past" && "opacity-55",
        state === "current" && "ring-2 ring-foreground",
        isDragging && "shadow-xl",
      )}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="line-clamp-2 font-semibold">{o.title}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {o.confidence === "faible" && <TriangleAlert className="h-3 w-3 text-amber-700" aria-label="Extraction incertaine" />}
          {o.recurrence === "WEEKLY" && <Repeat className="h-3 w-3 opacity-60" aria-label="Cours récurrent" />}
          {o.weekPattern !== "ALL" && <span className="rounded bg-foreground/10 px-1 text-[9px] font-bold">{o.weekPattern}</span>}
        </span>
      </span>
      <span className="tnum mt-0.5 block opacity-75">{formatMinutes(o.startMinutes)} – {formatMinutes(o.endMinutes)}</span>
      {!compact && o.room && <span className="mt-1 flex items-center gap-1 truncate opacity-75"><MapPin className="h-3 w-3 shrink-0" aria-hidden /> {o.room}</span>}
      {!compact && o.teacher && <span className="flex items-center gap-1 truncate opacity-75"><User className="h-3 w-3 shrink-0" aria-hidden /> {o.teacher}</span>}
      {state === "current" && !compact && <span className="mt-1 inline-block rounded-full bg-foreground px-1.5 py-px text-[10px] font-medium text-background">En cours</span>}
    </button>
  );
}

function DayColumn({ date, items, today, now, onCreate, onOpen }: { date: string; items: OccurrenceDto[]; today: boolean; now: { date: string; minutes: number }; onCreate: (start: number) => void; onOpen: (o: OccurrenceDto) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: date });
  return (
    <div
      ref={setNodeRef}
      role="presentation"
      className={cn("relative border-l border-border/60", today && "bg-muted/40", isOver && "bg-primary/5")}
      style={{ height: GRID_HEIGHT }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
        onCreate(Math.min(DAY_END - 60, DAY_START + Math.floor(y / PX_PER_MIN / SNAP) * SNAP));
      }}
    >
      {layoutLanes(items).map(({ o, lane, lanes }) => <CourseCard key={o.key} o={o} lane={lane} lanes={lanes} state={classifyOccurrence(o, now.date, now.minutes)} onOpen={() => onOpen(o)} />)}
      {today && now.minutes >= DAY_START && now.minutes <= DAY_END && (
        <div className="pointer-events-none absolute inset-x-0 z-20 h-px bg-foreground" style={{ top: yOf(now.minutes) }} aria-hidden>
          <span className="niala-pointer-right absolute -left-1 -top-[5px]" />
        </div>
      )}
    </div>
  );
}

export default function AgendaView() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [now, setNow] = useState(localClock);
  const [weekStart, setWeekStart] = useState(() => mondayOf(localClock().date));
  const [selectedDay, setSelectedDay] = useState(() => localClock().date);
  const [data, setData] = useState<AgendaData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [importing, setImporting] = useState(false);
  const [askScope, setAskScope] = useState<{ title: string; apply: (s: Scope) => Promise<void> } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    try {
      setData(await api.get<AgendaData>(`/api/agenda?from=${weekStart}&to=${addDays(weekStart, 6)}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(localClock()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Actions demandées depuis la barre d'outils ou le tableau de bord.
  const action = search.get("action");
  useEffect(() => {
    if (!action) return;
    if (action === "import") setImporting(true);
    if (action === "add") setEditor({ mode: "create", date: localClock().date, startMinutes: 480, endMinutes: 570 });
    router.replace(pathname);
  }, [action, pathname, router]);

  const byDay = (date: string) => (data?.occurrences ?? []).filter((o) => o.date === date);
  const thisWeek = mondayOf(now.date) === weekStart;

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
    const start = Math.max(DAY_START, Math.min(DAY_END - duration, o.startMinutes + Math.round(e.delta.y / PX_PER_MIN / SNAP) * SNAP));
    if (date === o.date && start === o.startMinutes) return;
    const values = { date, startMinutes: start, endMinutes: start + duration };
    const run = async (scope: Scope) => {
      try {
        await patchEvent(o, values, scope);
      } catch (err) {
        notify({ title: "Déplacement impossible", description: err instanceof Error ? err.message : undefined, variant: "error" });
      }
    };
    if (o.recurrence === "WEEKLY") setAskScope({ title: o.title, apply: run });
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
    const series = o.recurrence === "WEEKLY" && scope === "all";
    if (!(await confirmAction(series ? `Supprimer toutes les séances de « ${o.title} » ?` : `Supprimer « ${o.title} » ?`, { confirmLabel: "Supprimer" }))) return;
    await api.del(`/api/agenda/events/${o.eventId}?scope=${scope}&date=${o.originalDate}`);
    notify({ title: "Cours supprimé", variant: "success" });
    setEditor(null);
    await load();
  }

  async function duplicate() {
    if (editor?.mode !== "edit") return;
    const o = editor.occurrence;
    const saved = await withConfirm((force) => api.post("/api/agenda/events", { title: o.title, subjectId: o.subjectId, kind: o.kind, date: addDays(o.date, 1), startMinutes: o.startMinutes, endMinutes: o.endMinutes, recurrence: o.recurrence, until: o.until, weekPattern: o.weekPattern, room: o.room, teacher: o.teacher, groupName: o.groupName, description: o.description, force }));
    if (saved) {
      notify({ title: "Cours dupliqué", description: "La copie est placée le lendemain : déplacez-la si besoin.", variant: "success" });
      setEditor(null);
      await load();
    }
  }

  async function toggleWeekSwap() {
    if (!data) return;
    await api.patch("/api/agenda/settings", { weekSwap: !data.weekSwap });
    await load();
  }

  const addSubject = (s: SubjectOption) => setData((d) => (d ? { ...d, subjects: [...d.subjects, s] } : d));
  const openCreate = (date: string, start: number) => setEditor({ mode: "create", date, startMinutes: start, endMinutes: Math.min(DAY_END, start + 60) });
  const empty = data !== null && data.occurrences.length === 0;
  const dayItems = byDay(selectedDay);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="typo-h1">Agenda</h1>
          <p className="typo-subtitle mt-0.5">
            {formatDay(weekStart, { day: "numeric", month: "long" })} – {formatDay(addDays(weekStart, 6), { day: "numeric", month: "long", year: "numeric" })} · semaine {isoWeek(weekStart)}
            {data && <button type="button" className="ml-2 rounded-full border px-2 py-px text-xs hover:bg-muted" title="Inverser semaines A et B selon votre établissement" onClick={() => void toggleWeekSwap()}>Semaine {weekLetter(weekStart, data.weekSwap)}</button>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border p-0.5">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="Semaine précédente" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
            <Button variant={thisWeek ? "secondary" : "ghost"} size="sm" className="h-8 rounded-full" onClick={() => { setWeekStart(mondayOf(now.date)); setSelectedDay(now.date); }}>Cette semaine</Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" aria-label="Semaine suivante" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
          </div>
          <Button variant="outline" className="gap-2 rounded-full" onClick={() => setImporting(true)}><FileUp className="h-4 w-4" aria-hidden /> Importer mon emploi du temps</Button>
          <Button className="gap-2 rounded-full" onClick={() => openCreate(now.date, 480)}><Plus className="h-4 w-4" aria-hidden /> Ajouter un cours</Button>
        </div>
      </header>

      {error && !data && (
        <div className="mt-6 rounded-3xl border p-8 text-center">
          <p className="typo-subtitle">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}>Réessayer</Button>
        </div>
      )}
      {!data && !error && <Skeleton className="mt-5 h-[600px] rounded-3xl" aria-busy />}

      {data && empty && (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm">
          <CalendarPlus className="h-4 w-4" aria-hidden /> Aucun cours cette semaine. Cliquez sur un créneau de la grille, ou importez votre emploi du temps.
        </p>
      )}

      {data && (
        <>
          {/* Grand écran et tablette : semaine complète */}
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="mt-4 hidden overflow-x-auto rounded-3xl border bg-card p-3 md:block">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[60px_repeat(7,minmax(112px,1fr))] gap-1 pb-2">
                  <span className="pt-2 text-center text-xs text-muted-foreground">S{isoWeek(weekStart)}</span>
                  {days.map((d) => {
                    const today = d === now.date;
                    return (
                      <div key={d} className={cn("rounded-2xl py-2 text-center", today ? "bg-foreground text-background" : "bg-muted/50")} aria-current={today ? "date" : undefined}>
                        <p className="text-xs font-semibold uppercase tracking-wide">{DAY_NAMES[weekday(d) - 1]}</p>
                        <p className="tnum text-[11px] opacity-75">{formatDay(d, { day: "2-digit", month: "2-digit" })}</p>
                      </div>
                    );
                  })}
                </div>
                <div className="relative grid grid-cols-[60px_repeat(7,minmax(112px,1fr))] gap-x-1">
                  <div className="relative" style={{ height: GRID_HEIGHT }}>
                    {TIME_MARKS.map((m) => <span key={m} className="tnum absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: yOf(m) }}>{formatMinutes(m)}</span>)}
                  </div>
                  {days.map((d) => <DayColumn key={d} date={d} items={byDay(d)} today={d === now.date} now={now} onCreate={(s) => openCreate(d, s)} onOpen={(o) => setEditor({ mode: "edit", occurrence: o })} />)}
                  <div className="pointer-events-none absolute inset-y-0 left-[60px] right-0" aria-hidden>
                    {TIME_MARKS.map((m) => <div key={m} className="absolute inset-x-0 border-t border-border/50" style={{ top: yOf(m) }} />)}
                  </div>
                  {BREAKS.map((b) => (
                    <div key={b.start} className="niala-break pointer-events-none absolute left-[60px] right-0 flex items-center justify-center" style={{ top: yOf(b.start), height: (b.end - b.start) * PX_PER_MIN }}>
                      <span className="rounded-full bg-background/80 px-2 text-[10px] font-medium text-muted-foreground">{b.label} · {formatMinutes(b.start)} – {formatMinutes(b.end)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </DndContext>

          {/* Téléphone : une journée à la fois */}
          <div className="mt-4 md:hidden">
            <div className="flex gap-1 overflow-x-auto pb-2" role="tablist" aria-label="Jours de la semaine">
              {days.map((d) => (
                <button key={d} type="button" role="tab" aria-selected={d === selectedDay} onClick={() => setSelectedDay(d)} className={cn("min-w-12 flex-1 rounded-2xl py-2 text-center", d === selectedDay ? "bg-foreground text-background" : "bg-muted/60", d === now.date && d !== selectedDay && "ring-1 ring-foreground")}>
                  <span className="block text-[11px] font-semibold">{DAY_NAMES[weekday(d) - 1].slice(0, 3)}</span>
                  <span className="tnum text-xs">{formatDay(d, { day: "2-digit" })}</span>
                </button>
              ))}
            </div>
            <ul className="mt-2 space-y-2">
              {dayItems.length === 0 && <li className="rounded-2xl border p-6 text-center text-sm text-muted-foreground">Aucun cours ce jour-là.</li>}
              {dayItems.map((o) => {
                const state = classifyOccurrence(o, now.date, now.minutes);
                return (
                  <li key={o.key}>
                    <button type="button" onClick={() => setEditor({ mode: "edit", occurrence: o })} className={cn("w-full rounded-2xl p-3 text-left", state === "past" && "opacity-55", state === "current" && "ring-2 ring-foreground")} style={{ background: `color-mix(in srgb, ${colorOf(o)} 30%, var(--card))` }}>
                      <span className="tnum text-xs opacity-75">{formatMinutes(o.startMinutes)} – {formatMinutes(o.endMinutes)}{state === "current" ? " · En cours" : ""}</span>
                      <span className="block font-semibold">{o.title}</span>
                      {(o.room || o.teacher) && <span className="block text-xs opacity-75">{[o.room, o.teacher].filter(Boolean).join(" · ")}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button variant="outline" className="mt-3 w-full gap-2 rounded-full" onClick={() => openCreate(selectedDay, 480)}><Plus className="h-4 w-4" aria-hidden /> Ajouter ce jour-là</Button>
          </div>
        </>
      )}

      {editor && data && <EventDialog key={editor.mode === "edit" ? editor.occurrence.key : "create"} state={editor} subjects={data.subjects} onClose={() => setEditor(null)} onSubmit={submit} onDelete={remove} onDuplicate={duplicate} onSubjectCreated={addSubject} />}
      {importing && <ImportDialog weekStart={weekStart} onClose={() => setImporting(false)} onDone={() => { setImporting(false); void load(); }} />}
      {askScope && (
        <Dialog open onOpenChange={(v) => !v && setAskScope(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Déplacer « {askScope.title} »</DialogTitle>
              <DialogDescription>Ce cours se répète chaque semaine.</DialogDescription>
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
