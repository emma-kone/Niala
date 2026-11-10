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
import { PRIORITY_LABEL, STATUS_LABEL, TASK_META, formatDay, fromTimeInput, localClock, toTimeInput, type SubjectOption, type TaskDto } from "./types";
import { announceTasksChanged } from "./use-course-reminders";

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const REMINDERS = [{ v: "0", l: "À l'heure prévue" }, { v: "15", l: "15 minutes avant" }, { v: "60", l: "1 heure avant" }, { v: "1440", l: "La veille (24 heures avant)" }, { v: "10080", l: "1 semaine avant" }, { v: "", l: "Aucun rappel" }];
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
  const [type, setType] = useState<string>(task?.type ?? draft?.type ?? "AUTRE");
  const [subjectId, setSubjectId] = useState(task?.subjectId ?? draft?.subjectId ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? draft?.dueDate ?? localClock().date);
  const [dueTime, setDueTime] = useState(toTimeInput(task?.dueMinutes ?? null));
  const [priority, setPriority] = useState<string>(task?.priority ?? "NORMALE");
  const [status, setStatus] = useState<string>(task?.storedStatus ?? "A_COMMENCER");
  const [duration, setDuration] = useState(task?.estimatedMinutes ? String(task.estimatedMinutes) : "");
  const [submission, setSubmission] = useState(task?.requiresSubmission ?? false);
  const [reminder, setReminder] = useState(task ? String(task.reminderMinutes?.[0] ?? "") : "0");
  const [weekly, setWeekly] = useState(task?.recurrence === "WEEKLY");
  const [description, setDescription] = useState(task?.description ?? "");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Une nouvelle tâche a toujours une heure : c'est à cette heure que le rappel est envoyé.
  const timeRequired = !task || task.dueMinutes !== null;

  async function save() {
    if (timeRequired && !dueTime) return setError("Indiquez l'heure à laquelle effectuer la tâche.");
    const minutes = duration.trim() ? Number(duration) : null;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 15 || minutes > 10_000)) return setError("La durée s'indique en minutes (15 au minimum).");
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        type,
        subjectId: subjectId || null,
        dueDate,
        dueMinutes: dueTime ? fromTimeInput(dueTime) : null,
        priority,
        status,
        estimatedMinutes: minutes,
        requiresSubmission: submission,
        reminderMinutes: reminder ? [Number(reminder)] : [],
        recurrence: weekly ? "WEEKLY" : "NONE",
        description: description.trim() || null,
        ...(task ? {} : { documentId: draft?.documentId ?? null, exerciseId: draft?.exerciseId ?? null, parentId: draft?.parentId ?? null }),
      };
      if (task) await api.patch(`/api/agenda/tasks/${task.id}`, body);
      else await api.post("/api/agenda/tasks", body);
      notify({ title: task ? "Tâche mise à jour" : "Tâche ajoutée", description: reminder ? `Rappel : ${REMINDERS.find((r) => r.v === reminder)?.l.toLowerCase()}.` : undefined, variant: "success" });
      announceTasksChanged();
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
    announceTasksChanged();
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Modifier la tâche" : draft?.parentId ? "Ajouter une étape" : "Nouvelle tâche"}</DialogTitle>
          <DialogDescription>Ce que vous avez à faire, et quand. Un rappel vous est envoyé à l&apos;heure choisie.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="t-title">Tâche</Label>
            <Input id="t-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Faire l'exercice d'algorithmique" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-date">Date</Label>
            <Input id="t-date" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-time">Heure{timeRequired ? "" : " (facultatif)"}</Label>
            <Input id="t-time" type="time" required={timeRequired} value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-duration">Durée en minutes (facultatif)</Label>
            <Input id="t-duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ""))} placeholder="Ex. 45" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="t-rem">Rappel</Label>
            <select id="t-rem" className={selectCls} value={reminder} onChange={(e) => setReminder(e.target.value)}>{[...REMINDERS, ...(REMINDERS.some((r) => r.v === reminder) ? [] : [{ v: reminder, l: `${reminder} minutes avant` }])].map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}</select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="t-desc">Description (facultatif)</Label>
            <Textarea id="t-desc" rows={3} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ce qu'il faut faire, les pages, l'énoncé…" />
          </div>
          <button type="button" className="text-left text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline sm:col-span-2" aria-expanded={more} onClick={() => setMore((v) => !v)}>{more ? "Moins d'options" : "Plus d'options (type, matière, priorité, statut, répétition)"}</button>
          {more && (
            <>
              <div className="space-y-1">
                <Label htmlFor="t-type">Type</Label>
                <select id="t-type" className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(TASK_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-subject">Matière</Label>
                <select id="t-subject" className={selectCls} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Aucune</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-prio">Priorité</Label>
                <select id="t-prio" className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value)}>{Object.entries(PRIORITY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="t-status">Statut</Label>
                <select id="t-status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>{EDITABLE_STATUS.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">Une remise officielle est attendue<Switch checked={submission} onCheckedChange={setSubmission} aria-label="Remise officielle attendue" /></label>
              <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">Répéter chaque semaine<Switch checked={weekly} onCheckedChange={setWeekly} aria-label="Répéter chaque semaine" /></label>
            </>
          )}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-1">
            {task && <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>}
            {task && task.estimatedMinutes && <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={busy} onClick={() => onPlan(task)}><CalendarClock className="h-4 w-4" aria-hidden /> Répartir en séances</Button>}
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
      announceTasksChanged();
      notify({ title: "Séances de travail enregistrées", description: `${rows.length} séance(s) pour « ${task.title} ».`, variant: "success" });
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
