"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { confirmAction, notify } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DAY_NAMES, PRIORITY_LABEL, STATUS_LABEL, TASK_META, formatDay, fromTimeInput, localClock, toTimeInput, type BreakDto, type SubjectOption, type TaskDto } from "./types";

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const REMINDERS = [{ v: "", l: "Aucun rappel" }, { v: "120", l: "2 heures avant" }, { v: "1440", l: "24 heures avant" }, { v: "2880", l: "2 jours avant" }, { v: "10080", l: "1 semaine avant" }];
const EDITABLE_STATUS = ["A_COMMENCER", "EN_COURS", "EN_ATTENTE", "TERMINE", "SOUMIS", "ANNULE"] as const;
const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);

export interface TaskDraft {
  title?: string;
  type?: string;
  subjectId?: string | null;
  documentId?: string | null;
  exerciseId?: string | null;
  parentId?: string | null;
  dueDate?: string;
}

interface TaskDialogProps {
  task: TaskDto | null;
  draft?: TaskDraft;
  subjects: SubjectOption[];
  onClose: () => void;
  onSaved: () => void;
  onPlan: (t: TaskDto) => void;
  onAddStep: (t: TaskDto) => void;
}

export function TaskDialog({ task, draft, subjects, onClose, onSaved, onPlan, onAddStep }: TaskDialogProps) {
  const [title, setTitle] = useState(task?.title ?? draft?.title ?? "");
  const [type, setType] = useState<string>(task?.type ?? draft?.type ?? "DEVOIR");
  const [subjectId, setSubjectId] = useState(task?.subjectId ?? draft?.subjectId ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? draft?.dueDate ?? localClock().date);
  const [dueTime, setDueTime] = useState(toTimeInput(task?.dueMinutes ?? null));
  const [priority, setPriority] = useState<string>(task?.priority ?? "NORMALE");
  const [status, setStatus] = useState<string>(task?.storedStatus ?? "A_COMMENCER");
  const [estimated, setEstimated] = useState(task?.estimatedMinutes ? String(task.estimatedMinutes / 60) : "");
  const [submission, setSubmission] = useState(task?.requiresSubmission ?? false);
  const [reminder, setReminder] = useState(task ? String(task.reminderMinutes?.[0] ?? "") : "1440");
  const [weekly, setWeekly] = useState(task?.recurrence === "WEEKLY");
  const [description, setDescription] = useState(task?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const hours = estimated.replace(",", ".");
      const body = {
        title: title.trim(),
        type,
        subjectId: subjectId || null,
        dueDate,
        dueMinutes: dueTime ? fromTimeInput(dueTime) : null,
        priority,
        status,
        estimatedMinutes: hours ? Math.round(Number(hours) * 60) : null,
        requiresSubmission: submission,
        reminderMinutes: reminder ? [Number(reminder)] : [],
        recurrence: weekly ? "WEEKLY" : "NONE",
        description: description.trim() || null,
        ...(task ? {} : { documentId: draft?.documentId ?? null, exerciseId: draft?.exerciseId ?? null, parentId: draft?.parentId ?? null }),
      };
      if (task) await api.patch(`/api/agenda/tasks/${task.id}`, body);
      else await api.post("/api/agenda/tasks", body);
      notify({ title: task ? "Tâche mise à jour" : "Tâche ajoutée", variant: "success" });
      onSaved();
    } catch (e) {
      setError(errText(e, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!task || !(await confirmAction(`Supprimer « ${task.title} » et ses séances de travail ?`, { confirmLabel: "Supprimer" }))) return;
    await api.del(`/api/agenda/tasks/${task.id}`);
    notify({ title: "Tâche supprimée", variant: "success" });
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Modifier la tâche" : draft?.parentId ? "Ajouter une étape" : "Nouvelle tâche"}</DialogTitle>
          <DialogDescription>Devoir, TD à rendre, projet, révision…</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="t-title">Titre</Label>
            <Input id="t-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. TD Java EE à rendre" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-type">Type</Label>
            <select id="t-type" className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TASK_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-subject">Matière</Label>
            <select id="t-subject" className={selectCls} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Aucune</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-date">Date limite</Label>
            <Input id="t-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-time">Heure limite (facultatif)</Label>
            <Input id="t-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-prio">Priorité</Label>
            <select id="t-prio" className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value)}>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-status">Statut</Label>
            <select id="t-status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>{EDITABLE_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-est">Temps estimé (heures)</Label>
            <Input id="t-est" inputMode="decimal" value={estimated} onChange={(e) => setEstimated(e.target.value)} placeholder="Ex. 4" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-rem">Rappel</Label>
            <select id="t-rem" className={selectCls} value={reminder} onChange={(e) => setReminder(e.target.value)}>{REMINDERS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">Une remise officielle est attendue<Switch checked={submission} onCheckedChange={setSubmission} aria-label="Remise officielle attendue" /></label>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">Répéter chaque semaine<Switch checked={weekly} onCheckedChange={setWeekly} aria-label="Répéter chaque semaine" /></label>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="t-desc">Description</Label>
            <Textarea id="t-desc" rows={2} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {task && <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>}
            {task && <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={busy} onClick={() => onPlan(task)}><CalendarClock className="h-4 w-4" aria-hidden /> Planifier</Button>}
            {task?.type === "PROJET" && <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => onAddStep(task)}><Plus className="h-4 w-4" aria-hidden /> Étape</Button>}
          </div>
          <Button type="button" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Proposal {
  feasible: boolean;
  message: string;
  plannedMinutes: number;
  missingMinutes: number;
  sessions: { date: string; startMinutes: number; endMinutes: number; label: string }[];
}

/** Proposition de séances : rien n'est enregistré sans l'accord de l'étudiant. */
export function PlanDialog({ task, onClose, onSaved }: { task: TaskDto; onClose: () => void; onSaved: () => void }) {
  const [plan, setPlan] = useState<Proposal | null>(null);
  const [rows, setRows] = useState<Proposal["sessions"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const c = localClock();
    api.get<Proposal>(`/api/agenda/tasks/${task.id}/plan?date=${c.date}&minutes=${c.minutes}`).then((p) => { setPlan(p); setRows(p.sessions); }).catch((e) => setError(errText(e, "Proposition impossible.")));
  }, [task.id]);

  const update = (i: number, v: Partial<Proposal["sessions"][number]>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...v } : x)));

  async function accept(force = false) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/agenda/tasks/${task.id}/plan`, { sessions: rows.map(({ date, startMinutes, endMinutes }) => ({ date, startMinutes, endMinutes })), force });
      notify({ title: "Séances ajoutées à l'agenda", description: `${rows.length} séance(s) pour « ${task.title} ».`, variant: "success" });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && !force) {
        setBusy(false);
        if (await confirmAction(`${e.message} Enregistrer quand même ?`, { confirmLabel: "Enregistrer quand même", danger: false })) await accept(true);
        return;
      }
      setError(errText(e, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Planifier « {task.title} »</DialogTitle>
          <DialogDescription>Proposition à accepter, modifier ou refuser.</DialogDescription>
        </DialogHeader>
        {!plan && !error && <p className="text-sm text-muted-foreground" role="status">Recherche des créneaux disponibles…</p>}
        {plan && <p role="status" className={plan.feasible ? "rounded-xl bg-muted/60 p-3 text-sm" : "rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm"}>{plan.message}</p>}
        <ul className="space-y-2">
          {rows.map((s, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2 rounded-xl border p-2">
              <p className="col-span-4 text-xs font-medium">{s.label} · {formatDay(s.date, { weekday: "long", day: "numeric", month: "long" })}</p>
              <Input aria-label="Date" type="date" className="h-8 text-xs" value={s.date} onChange={(e) => update(i, { date: e.target.value })} />
              <Input aria-label="Début" type="time" className="h-8 text-xs" value={toTimeInput(s.startMinutes)} onChange={(e) => update(i, { startMinutes: fromTimeInput(e.target.value) ?? s.startMinutes })} />
              <Input aria-label="Fin" type="time" className="h-8 text-xs" value={toTimeInput(s.endMinutes)} onChange={(e) => update(i, { endMinutes: fromTimeInput(e.target.value) ?? s.endMinutes })} />
              <button type="button" aria-label="Retirer cette séance" className="rounded p-1.5 text-destructive hover:bg-muted" onClick={() => setRows((r) => r.filter((_, n) => n !== i))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose}>Refuser</Button>
          <Button disabled={busy || !rows.length} onClick={() => void accept()}>{busy ? "Enregistrement…" : "Accepter ces séances"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Prefs {
  workStart: number;
  workEnd: number;
  maxDailyMinutes: number;
  restMinutes: number;
  weekends: boolean;
  quietStart: number;
  quietEnd: number;
  courseReminderMinutes: number;
  taskReminders: boolean;
  sessionReminders: boolean;
  lateReminders: boolean;
}

/** Préférences de travail, heures de tranquillité et pauses personnelles. */
export function PrefsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [breaks, setBreaks] = useState<BreakDto[]>([]);
  const [label, setLabel] = useState("Pause");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [day, setDay] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadBreaks = () => api.get<{ breaks: BreakDto[] }>("/api/agenda/breaks").then((r) => setBreaks(r.breaks));

  useEffect(() => {
    api.get<{ preferences: Prefs }>("/api/agenda/preferences").then((r) => setPrefs(r.preferences)).catch((e) => setError(errText(e, "Chargement impossible.")));
    void loadBreaks().catch(() => undefined);
  }, []);

  const set = (v: Partial<Prefs>) => setPrefs((p) => (p ? { ...p, ...v } : p));
  const time = (key: keyof Prefs, text: string) => (
    <div className="space-y-1">
      <Label>{text}</Label>
      <Input type="time" value={prefs ? toTimeInput(prefs[key] as number) : ""} onChange={(e) => { const m = fromTimeInput(e.target.value); if (m !== null) set({ [key]: m } as Partial<Prefs>); }} />
    </div>
  );

  async function addBreak() {
    const s = fromTimeInput(start);
    const e = fromTimeInput(end);
    if (s === null || e === null) return setError("Indiquez le début et la fin de la pause.");
    try {
      await api.post("/api/agenda/breaks", { label: label.trim() || "Pause", startMinutes: s, endMinutes: e, weekday: day ? Number(day) : null });
      setStart("");
      setEnd("");
      setError(null);
      await loadBreaks();
      onSaved();
    } catch (err) {
      setError(errText(err, "Ajout impossible."));
    }
  }

  async function save() {
    try {
      await api.put("/api/agenda/preferences", prefs);
      notify({ title: "Préférences enregistrées", variant: "success" });
      onSaved();
      onClose();
    } catch (e) {
      setError(errText(e, "Enregistrement impossible."));
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Préférences de l&apos;agenda</DialogTitle>
          <DialogDescription>Utilisées pour proposer des séances et envoyer les rappels.</DialogDescription>
        </DialogHeader>
        {prefs && (
          <div className="grid grid-cols-2 gap-3">
            {time("workStart", "Travailler à partir de")}
            {time("workEnd", "Jusqu'à")}
            <div className="space-y-1"><Label htmlFor="p-max">Maximum par jour (min)</Label><Input id="p-max" type="number" min={30} max={720} value={prefs.maxDailyMinutes} onChange={(e) => set({ maxDailyMinutes: Number(e.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="p-rest">Repos entre activités (min)</Label><Input id="p-rest" type="number" min={0} max={120} value={prefs.restMinutes} onChange={(e) => set({ restMinutes: Number(e.target.value) })} /></div>
            {time("quietStart", "Tranquillité à partir de")}
            {time("quietEnd", "Jusqu'à")}
            <label className="col-span-2 flex items-center justify-between rounded-lg border p-3 text-sm">Travailler le week-end<Switch checked={prefs.weekends} onCheckedChange={(v) => set({ weekends: v })} aria-label="Travailler le week-end" /></label>
            <h3 className="col-span-2 text-sm font-semibold">Rappels</h3>
            <div className="col-span-2 space-y-1"><Label htmlFor="p-course">Avant un cours (minutes, 0 pour aucun rappel)</Label><Input id="p-course" type="number" min={0} max={240} value={prefs.courseReminderMinutes} onChange={(e) => set({ courseReminderMinutes: Number(e.target.value) })} /></div>
            <label className="col-span-2 flex items-center justify-between rounded-lg border p-3 text-sm">Tâches, au moment choisi pour chacune<Switch checked={prefs.taskReminders} onCheckedChange={(v) => set({ taskReminders: v })} aria-label="Rappels de tâches" /></label>
            <label className="col-span-2 flex items-center justify-between rounded-lg border p-3 text-sm">Séances de travail, 10 minutes avant<Switch checked={prefs.sessionReminders} onCheckedChange={(v) => set({ sessionReminders: v })} aria-label="Rappels de séances" /></label>
            <label className="col-span-2 flex items-center justify-between rounded-lg border p-3 text-sm">Récapitulatif des retards, une fois par jour<Switch checked={prefs.lateReminders} onCheckedChange={(v) => set({ lateReminders: v })} aria-label="Récapitulatif des retards" /></label>
          </div>
        )}
        <section aria-label="Pauses" className="space-y-2">
          <h3 className="text-sm font-semibold">Mes pauses</h3>
          {breaks.length === 0 && <p className="text-xs text-muted-foreground">Aucune pause : elles viennent de votre emploi du temps importé, ou se saisissent ici.</p>}
          <ul className="space-y-1">
            {breaks.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
                <span>{b.label} · {toTimeInput(b.startMinutes)} – {toTimeInput(b.endMinutes)} · {b.weekday ? DAY_NAMES[b.weekday - 1] : "tous les jours"}</span>
                <button type="button" aria-label={`Supprimer ${b.label}`} className="rounded p-1 text-destructive hover:bg-muted" onClick={() => void api.del(`/api/agenda/breaks/${b.id}`).then(loadBreaks).then(onSaved)}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
            <Input aria-label="Nom de la pause" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className="h-8 text-xs" />
            <Input aria-label="Début" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-24 text-xs" />
            <Input aria-label="Fin" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-24 text-xs" />
            <select aria-label="Jour" className="col-span-2 h-8 rounded-md border bg-background px-2 text-xs" value={day} onChange={(e) => setDay(e.target.value)}><option value="">Tous les jours</option>{DAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>
            <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void addBreak()}>Ajouter</Button>
          </div>
        </section>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter><Button disabled={!prefs} onClick={() => void save()}>Enregistrer</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
