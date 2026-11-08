"use client";

import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fromTimeInput, toTimeInput, type OccurrenceDto, type Scope, type SubjectOption } from "./types";

export type EditorState = { mode: "create"; date: string; startMinutes: number; endMinutes: number } | { mode: "edit"; occurrence: OccurrenceDto };

export interface EventValues {
  title: string;
  subjectId: string | null;
  kind: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  recurrence: "NONE" | "WEEKLY";
  until: string | null;
  weekPattern: "ALL" | "A" | "B";
  room: string | null;
  teacher: string | null;
  description: string | null;
}

interface Props {
  state: EditorState;
  subjects: SubjectOption[];
  onClose: () => void;
  onSubmit: (values: EventValues, scope: Scope) => Promise<void>;
  onDelete: (scope: Scope) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onSubjectCreated: (s: SubjectOption) => void;
}

const selectCls = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const NEW_SUBJECT = "__new__";

export function EventDialog({ state, subjects, onClose, onSubmit, onDelete, onDuplicate, onSubjectCreated }: Props) {
  const o = state.mode === "edit" ? state.occurrence : null;
  const recurringEvent = o?.recurrence === "WEEKLY";
  const [title, setTitle] = useState(o?.title ?? "");
  const [subjectId, setSubjectId] = useState(o?.subjectId ?? "");
  const [newSubject, setNewSubject] = useState("");
  const [kind, setKind] = useState(o?.kind ?? "COURSE");
  const [date, setDate] = useState(o?.date ?? (state.mode === "create" ? state.date : ""));
  const [start, setStart] = useState(toTimeInput(o?.startMinutes ?? (state.mode === "create" ? state.startMinutes : null)));
  const [end, setEnd] = useState(toTimeInput(o?.endMinutes ?? (state.mode === "create" ? state.endMinutes : null)));
  const [weekly, setWeekly] = useState(recurringEvent);
  const [until, setUntil] = useState(o?.until ?? "");
  const [weekPattern, setWeekPattern] = useState<"ALL" | "A" | "B">(o?.weekPattern ?? "ALL");
  const [room, setRoom] = useState(o?.room ?? "");
  const [teacher, setTeacher] = useState(o?.teacher ?? "");
  const [description, setDescription] = useState(o?.description ?? "");
  const [scope, setScope] = useState<Scope>("occurrence");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  };

  async function save() {
    const startMinutes = fromTimeInput(start);
    const endMinutes = fromTimeInput(end);
    if (startMinutes === null || endMinutes === null) return setError("Indiquez une heure de début et de fin.");
    if (!date) return setError("Indiquez une date.");
    await run(async () => {
      let sid = subjectId === NEW_SUBJECT ? null : subjectId || null;
      if (subjectId === NEW_SUBJECT) {
        if (!newSubject.trim()) throw new Error("Indiquez le nom de la nouvelle matière.");
        try {
          const r = await api.post<{ subject: SubjectOption }>("/api/subjects", { name: newSubject.trim() });
          sid = r.subject.id;
          onSubjectCreated(r.subject);
        } catch (e) {
          throw e instanceof ApiError ? new Error(e.message) : e;
        }
      }
      await onSubmit(
        { title: title.trim(), subjectId: sid, kind, date, startMinutes, endMinutes, recurrence: weekly ? "WEEKLY" : "NONE", until: weekly && until ? until : null, weekPattern: weekly ? weekPattern : "ALL", room: room.trim() || null, teacher: teacher.trim() || null, description: description.trim() || null },
        recurringEvent ? scope : "all"
      );
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{o ? "Modifier le cours" : "Ajouter un cours"}</DialogTitle>
          <DialogDescription>Horaires libres entre 07:30 et 18:30.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ev-subject">Matière</Label>
            <select id="ev-subject" className={selectCls} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Sans matière</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value={NEW_SUBJECT}>+ Créer une matière…</option>
            </select>
            {subjectId === NEW_SUBJECT && <Input aria-label="Nom de la nouvelle matière" placeholder="Nom de la matière" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} />}
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ev-title">Titre {subjectId ? "(facultatif)" : ""}</Label>
            <Input id="ev-title" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Ex. Travaux dirigés d'algorithmique" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-kind">Type</Label>
            <select id="ev-kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="COURSE">Cours</option>
              <option value="REVISION">Révision</option>
              <option value="EVENT">Événement</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-date">Date</Label>
            <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-start">Début</Label>
            <Input id="ev-start" type="time" min="07:30" max="18:30" step={300} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-end">Fin</Label>
            <Input id="ev-end" type="time" min="07:30" max="18:30" step={300} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-room">Salle</Label>
            <Input id="ev-room" value={room} maxLength={120} onChange={(e) => setRoom(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-teacher">Enseignant</Label>
            <Input id="ev-teacher" value={teacher} maxLength={120} onChange={(e) => setTeacher(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="ev-desc">Description</Label>
            <Textarea id="ev-desc" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm sm:col-span-2">
            Répéter chaque semaine
            <Switch checked={weekly} onCheckedChange={setWeekly} aria-label="Répéter chaque semaine" />
          </label>
          {weekly && (
            <>
              <div className="space-y-1">
                <Label htmlFor="ev-week">Semaines</Label>
                <select id="ev-week" className={selectCls} value={weekPattern} onChange={(e) => setWeekPattern(e.target.value as "ALL" | "A" | "B")}>
                  <option value="ALL">Toutes les semaines</option>
                  <option value="A">Semaines A</option>
                  <option value="B">Semaines B</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ev-until">Jusqu&apos;au (facultatif)</Label>
                <Input id="ev-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
              </div>
            </>
          )}
          {recurringEvent && (
            <fieldset className="rounded-lg border p-3 text-sm sm:col-span-2">
              <legend className="px-1 text-xs text-muted-foreground">Appliquer à</legend>
              <label className="mr-4 inline-flex items-center gap-1.5"><input type="radio" name="scope" checked={scope === "occurrence"} onChange={() => setScope("occurrence")} /> Cette séance</label>
              <label className="inline-flex items-center gap-1.5"><input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} /> Toute la série</label>
            </fieldset>
          )}
        </div>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {o ? (
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive" disabled={busy} onClick={() => void run(() => onDelete(recurringEvent ? scope : "all"))}><Trash2 className="h-4 w-4" aria-hidden /> Supprimer</Button>
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={busy} onClick={() => void run(onDuplicate)}><Copy className="h-4 w-4" aria-hidden /> Dupliquer</Button>
            </div>
          ) : <span />}
          <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
