"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Section « Tâches et rappels » : activités personnelles et académiques à faire à une date et une heure précises
// (exercices, révisions, travaux…). Indépendante des emplois du temps : une tâche n'est jamais un cours.
// Le rappel part à l'heure prévue (ou avant, au choix), dans Niala et en notification du système si elle est autorisée.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, CheckCircle2, Circle, Clock, ListTodo, Plus, RotateCcw, Timer } from "lucide-react";
import { api } from "@/lib/client-api";
import { notify } from "@/components/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCachedState } from "@/hooks/use-cached-state";
import { useBackgroundRefresh } from "@/hooks/use-background-refresh";
import { daysBetween, formatMinutes } from "@/server/domain/schedule";
import { useSettings } from "@/features/settings/use-settings";
import { PlanDialog, TaskDialog, type TaskDraft } from "./task-dialogs";
import { announceTasksChanged } from "./use-course-reminders";
import { STATUS_LABEL, TASK_META, formatDay, localClock, type SubjectOption, type TaskDto } from "./types";

const DONE = (t: TaskDto) => t.status === "TERMINE" || t.status === "SOUMIS" || t.status === "ANNULE";
const errText = (e: unknown, fb: string) => (e instanceof Error && e.message ? e.message : fb);
const reminderText = (t: TaskDto) => {
  const m = t.reminderMinutes?.[0];
  if (m === undefined) return "Sans rappel";
  if (m === 0) return "Rappel à l'heure prévue";
  if (m < 60) return `Rappel ${m} min avant`;
  if (m < 1440) return `Rappel ${Math.round(m / 60)} h avant`;
  return m === 1440 ? "Rappel la veille" : `Rappel ${Math.round(m / 1440)} j avant`;
};

type Permission = "granted" | "denied" | "default" | "unsupported";
const readPermission = (): Permission => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
const subscribeNothing = () => () => undefined;

/** État des notifications : autorisation du navigateur et réglage « Activités et exercices » des Paramètres. */
function NotificationStatus() {
  const { settings, save } = useSettings();
  // Lue dans le navigateur uniquement (le rendu serveur ne connaît pas l'autorisation).
  const browserPermission = useSyncExternalStore(subscribeNothing, readPermission, () => "default" as Permission);
  const [asked, setPermission] = useState<Permission | null>(null);
  const permission = asked ?? browserPermission;
  const enabled = settings?.notifyActivities ?? true;

  async function ask() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") new Notification("Notifications activées", { body: "Niala vous préviendra à l'heure de vos tâches.", icon: "/icon.png" });
  }

  if (!enabled) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <BellOff className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Les rappels sont désactivés (Paramètres › Notifications › Tâches, cours et rappels).</span>
        <Button size="sm" variant="outline" onClick={() => void save({ notifyActivities: true }).catch((e) => notify({ title: "Réglage non enregistré", description: errText(e, ""), variant: "error" }))}>Réactiver les rappels</Button>
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted/50 p-3 text-sm">
      <Bell className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        {permission === "granted" && "Rappels actifs : un message s'affiche dans Niala et une notification apparaît sur votre appareil à l'heure prévue, tant que Niala est ouvert dans un onglet."}
        {permission === "default" && "Rappels actifs dans Niala. Autorisez les notifications pour être prévenu même quand l'onglet Niala n'est pas affiché."}
        {permission === "denied" && "Rappels actifs dans Niala uniquement : les notifications sont bloquées par votre navigateur (autorisez-les dans les réglages du site)."}
        {permission === "unsupported" && "Rappels actifs dans Niala. Ce navigateur ne permet pas les notifications du système."}
      </span>
      {permission === "default" && <Button size="sm" onClick={() => void ask()}>Autoriser les notifications</Button>}
    </div>
  );
}

function TaskRow({ t, current, onOpen, onToggle }: { t: TaskDto; current?: boolean; onOpen: () => void; onToggle: () => void }) {
  const meta = TASK_META[t.type] ?? TASK_META.AUTRE;
  const done = DONE(t);
  const late = t.status === "EN_RETARD" && !current;
  return (
    <li className={cn("flex items-start gap-3 rounded-2xl border bg-card p-3", late && "border-destructive/50", current && "border-primary ring-1 ring-primary/40", done && "opacity-65")}>
      <button type="button" onClick={onToggle} aria-label={done ? `Rouvrir « ${t.title} »` : `Marquer « ${t.title} » comme terminée`} data-hint={done ? "Rouvrir la tâche" : "Marquer comme terminée"} className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground">
        {done ? <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden /> : <Circle className="h-5 w-5" aria-hidden />}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" data-hint-action="Modifier la tâche">
        <span className={cn("block font-semibold", done && "line-through")}>{t.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className={cn("inline-flex items-center gap-1 tnum", late && "font-medium text-destructive")}><Clock className="h-3.5 w-3.5" aria-hidden />{t.dueMinutes !== null ? formatMinutes(t.dueMinutes) : "Dans la journée"}{late ? " · en retard" : current ? " · c'est l'heure" : ""}</span>
          {t.estimatedMinutes ? <span className="inline-flex items-center gap-1"><Timer className="h-3.5 w-3.5" aria-hidden />{t.estimatedMinutes} min</span> : null}
          {!done && <span className="inline-flex items-center gap-1"><Bell className="h-3.5 w-3.5" aria-hidden />{reminderText(t)}</span>}
          {t.subject && <span>{t.subject.name}</span>}
          {t.type !== "AUTRE" && <span>{meta.label}</span>}
          {done && <span>{STATUS_LABEL[t.status]}</span>}
        </span>
        {t.description && <span className="mt-1 line-clamp-2 block text-sm text-foreground/80">{t.description}</span>}
      </button>
    </li>
  );
}

function DayGroup({ date, today, tasks, render }: { date: string; today: string; tasks: TaskDto[]; render: (t: TaskDto) => React.ReactNode }) {
  const label = date === today ? "Aujourd'hui" : formatDay(date, { weekday: "long", day: "numeric", month: "long" });
  return (
    <section aria-label={label}>
      <h3 className="mb-1.5 text-sm font-semibold first-letter:uppercase">{label}</h3>
      <ul className="space-y-2">{tasks.map(render)}</ul>
    </section>
  );
}

/** `draftRequest` : tâche préremplie demandée par un autre module (« Planifier »), ouverte une fois. */
export function TasksSection({ draftRequest }: { draftRequest: { n: number; draft: TaskDraft } | null }) {
  const [tasks, setTasks] = useCachedState<TaskDto[] | null>(["agenda-tasks-list"], null);
  const [subjects, setSubjects] = useCachedState<SubjectOption[]>(["agenda-subjects"], []);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "done">("upcoming");
  const [editor, setEditor] = useState<{ task: TaskDto | null; draft?: TaskDraft } | null>(null);
  const [planning, setPlanning] = useState<TaskDto | null>(null);
  const [clock, setClock] = useState(localClock);

  const load = useCallback(async () => {
    const c = localClock();
    try {
      const [list, agenda] = await Promise.all([api.get<{ tasks: TaskDto[] }>(`/api/agenda/tasks?date=${c.date}&minutes=${c.minutes}`), api.get<{ subjects: SubjectOption[] }>(`/api/agenda?from=${c.date}&to=${c.date}`)]);
      setClock(c);
      setTasks(list.tasks);
      setSubjects(agenda.subjects);
      setError(null);
    } catch (e) {
      setError(errText(e, "Chargement impossible."));
    }
  }, [setTasks, setSubjects]);

  useEffect(() => {
    void load();
  }, [load]);
  // Les statuts « à faire maintenant » / « en retard » évoluent avec l'heure : relecture en arrière-plan chaque minute,
  // au retour sur l'onglet, et quand une tâche change dans un autre onglet. Suspendue pendant la saisie d'une tâche.
  useBackgroundRefresh(load, { topics: ["tasks"], enabled: !editor && !planning });

  const [seenDraft, setSeenDraft] = useState(0);
  if (draftRequest && draftRequest.n !== seenDraft) {
    setSeenDraft(draftRequest.n);
    setEditor({ task: null, draft: draftRequest.draft });
  }

  async function toggle(t: TaskDto) {
    const status = DONE(t) ? "A_COMMENCER" : t.requiresSubmission ? "SOUMIS" : "TERMINE";
    setTasks((list) => list?.map((x) => (x.id === t.id ? { ...x, status, storedStatus: status } : x)) ?? list);
    try {
      await api.patch(`/api/agenda/tasks/${t.id}`, { status });
      announceTasksChanged();
      if (status !== "A_COMMENCER") notify({ title: "Tâche terminée", description: t.title, variant: "success", durationMs: 2500 });
    } catch (e) {
      notify({ title: "Modification impossible", description: errText(e, ""), variant: "error" });
    }
    void load();
  }

  const { now, late, upcoming, done } = useMemo(() => {
    const list = tasks ?? [];
    const sort = (a: TaskDto, b: TaskDto) => a.dueDate.localeCompare(b.dueDate) || (a.dueMinutes ?? 1440) - (b.dueMinutes ?? 1440);
    // Une tâche dont l'heure vient d'arriver est « à faire maintenant » pendant sa durée (1 h par défaut), puis « en retard ».
    const overdue = (t: TaskDto) => clock.minutes - (daysBetween(clock.date, t.dueDate) * 1440 + (t.dueMinutes ?? 1440));
    const isNow = (t: TaskDto) => t.status === "EN_RETARD" && t.dueMinutes !== null && overdue(t) < (t.estimatedMinutes ?? 60);
    return {
      now: list.filter(isNow).sort(sort),
      late: list.filter((t) => t.status === "EN_RETARD" && !isNow(t)).sort(sort),
      upcoming: list.filter((t) => !DONE(t) && t.status !== "EN_RETARD").sort(sort),
      done: list.filter(DONE).sort((a, b) => sort(b, a)),
    };
  }, [tasks, clock]);
  const byDay = (list: TaskDto[]) => [...new Set(list.map((t) => t.dueDate))].map((d) => ({ date: d, tasks: list.filter((t) => t.dueDate === d) }));
  const row = (t: TaskDto) => <TaskRow key={t.id} t={t} onOpen={() => setEditor({ task: t })} onToggle={() => void toggle(t)} />;

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Tâches" className="flex gap-1 rounded-full border p-0.5">
          <button type="button" role="tab" aria-selected={tab === "upcoming"} onClick={() => setTab("upcoming")} className={cn("rounded-full px-3 py-1 text-sm font-medium", tab === "upcoming" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>À venir{now.length + late.length + upcoming.length ? ` (${now.length + late.length + upcoming.length})` : ""}</button>
          <button type="button" role="tab" aria-selected={tab === "done"} onClick={() => setTab("done")} className={cn("rounded-full px-3 py-1 text-sm font-medium", tab === "done" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>Effectuées{done.length ? ` (${done.length})` : ""}</button>
        </div>
        <Button className="ml-auto gap-2 rounded-full" onClick={() => setEditor({ task: null })}><Plus className="h-4 w-4" aria-hidden /> Nouvelle tâche</Button>
      </div>
      <NotificationStatus />

      {error && !tasks && (
        <div className="rounded-3xl border p-8 text-center">
          <p className="typo-subtitle">{error}</p>
          <Button className="mt-4" variant="outline" onClick={() => void load()}>Réessayer</Button>
        </div>
      )}
      {!tasks && !error && <Skeleton className="h-64 rounded-3xl" aria-busy />}

      {tasks && tab === "upcoming" && (
        now.length + late.length + upcoming.length === 0 ? (
          <div className="rounded-3xl border p-8 text-center">
            <ListTodo className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="mt-2 font-medium">Aucune tâche à venir</p>
            <p className="typo-meta mt-1">Exemple : « Faire l&apos;exercice d&apos;algorithmique » à 18 h 00 — vous serez prévenu à 18 h.</p>
            <Button className="mt-4 gap-2" onClick={() => setEditor({ task: null })}><Plus className="h-4 w-4" aria-hidden /> Créer une tâche</Button>
          </div>
        ) : (
          <div className="space-y-5">
            {now.length > 0 && (
              <section aria-label="À faire maintenant">
                <h3 className="mb-1.5 text-sm font-semibold text-primary">À faire maintenant</h3>
                <ul className="space-y-2">{now.map((t) => <TaskRow key={t.id} t={t} current onOpen={() => setEditor({ task: t })} onToggle={() => void toggle(t)} />)}</ul>
              </section>
            )}
            {late.length > 0 && (
              <section aria-label="En retard">
                <h3 className="mb-1.5 text-sm font-semibold text-destructive">En retard</h3>
                <ul className="space-y-2">{late.map(row)}</ul>
              </section>
            )}
            {byDay(upcoming).map((g) => <DayGroup key={g.date} date={g.date} today={clock.date} tasks={g.tasks} render={row} />)}
          </div>
        )
      )}

      {tasks && tab === "done" && (
        done.length === 0 ? <p className="rounded-3xl border p-8 text-center text-sm text-muted-foreground">Les tâches que vous marquez comme terminées apparaîtront ici.</p> : (
          <div className="space-y-5">
            {byDay(done.slice(0, 100)).map((g) => <DayGroup key={g.date} date={g.date} today={clock.date} tasks={g.tasks} render={row} />)}
            {done.length > 100 && <p className="typo-meta flex items-center gap-1"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Les 100 plus récentes sont affichées.</p>}
          </div>
        )
      )}

      {editor && <TaskDialog key={editor.task?.id ?? `new-${editor.draft?.parentId ?? ""}`} task={editor.task} draft={editor.draft} subjects={subjects} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(); }} onPlan={(t) => { setEditor(null); setPlanning(t); }} onAddStep={(t) => setEditor({ task: null, draft: { parentId: t.id, subjectId: t.subjectId, type: "PROJET", dueDate: t.dueDate } })} />}
      {planning && <PlanDialog task={planning} onClose={() => setPlanning(null)} onSaved={() => { setPlanning(null); void load(); }} />}
    </div>
  );
}
