"use client";

import { useRef, useState } from "react";
import { AlertTriangle, FileUp, Loader2, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { confirmAction, notify } from "@/components/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DAY_NAMES, fromTimeInput, toTimeInput, type SubjectOption } from "./types";

interface DraftRow {
  id: string;
  title: string;
  day: number | null;
  date: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  room: string | null;
  teacher: string | null;
  groupName: string | null;
  weekPattern: "ALL" | "A" | "B";
  recurring: boolean;
  notes: string | null;
  confidence: "elevee" | "moyenne" | "faible";
  issues: string[];
  subjectId: string | null;
  status: "nouveau" | "identique" | "modifie";
  changes: string[];
  subjectChoice?: string;
}

interface ImportResult {
  id: string;
  fileName: string;
  warnings: string[];
  subjects: SubjectOption[];
  events: DraftRow[];
  removed: { id: string; title: string; day: number; startMinutes: number; endMinutes: number }[];
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv";
const CREATE = "__create__";
const STATUS_LABEL = { nouveau: "Nouveau", identique: "Déjà présent", modifie: "Modifié" };
const CONFIDENCE_LABEL = { elevee: "Fiable", moyenne: "À vérifier", faible: "Incertain" };
const fieldCls = "h-8 w-full rounded-md border bg-background px-2 text-xs";

const initialChoice = (e: DraftRow) => e.subjectId ?? (e.title ? CREATE : "");

export function ImportDialog({ weekStart, onClose, onDone }: { weekStart: string; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [startDate, setStartDate] = useState(weekStart);
  const [mode, setMode] = useState<"add" | "replace">("add");
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await api.post<ImportResult>("/api/agenda/imports", form);
      setResult(r);
      setRows(r.events.map((e) => ({ ...e, subjectChoice: initialChoice(e) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, values: Partial<DraftRow>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...values } : r)));

  async function cancel() {
    if (result) await api.del(`/api/agenda/imports/${result.id}`).catch(() => undefined);
    onClose();
  }

  const incomplete = rows.filter((r) => !r.title.trim() || r.day === null || r.startMinutes === null || r.endMinutes === null);
  const hasHistory = !!result && (result.removed.length > 0 || rows.some((r) => r.status !== "nouveau"));

  async function confirm(force = false) {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const events = rows.map((r) => ({
        id: r.id,
        title: r.title.trim(),
        day: r.day,
        date: r.date,
        startMinutes: r.startMinutes,
        endMinutes: r.endMinutes,
        room: r.room,
        teacher: r.teacher,
        groupName: r.groupName,
        weekPattern: r.weekPattern,
        recurring: r.recurring,
        confidence: r.confidence,
        subjectId: r.subjectChoice && r.subjectChoice !== CREATE ? r.subjectChoice : null,
        createSubject: r.subjectChoice === CREATE,
      }));
      const done = await api.post<{ created: number; updated: number; removed: number; skipped: number }>(`/api/agenda/imports/${result.id}/confirm`, { mode, startDate, events, force });
      notify({ title: "Emploi du temps importé", description: `${done.created} cours ajouté(s), ${done.updated} modifié(s), ${done.removed} retiré(s), ${done.skipped} déjà présent(s).`, variant: "success" });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && !force) {
        setBusy(false);
        if (await confirmAction(`${e.message} Importer quand même ?`, { confirmLabel: "Importer quand même", danger: false })) await confirm(true);
        return;
      }
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && void cancel()}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", result ? "sm:max-w-5xl" : "sm:max-w-lg")}>
        <DialogHeader>
          <DialogTitle>Importer mon emploi du temps</DialogTitle>
          <DialogDescription>{result ? `Vérifiez ce qui a été lu dans « ${result.fileName} ». Rien n'est ajouté à votre agenda avant votre validation.` : "Niala lit votre document et vous propose les cours détectés, à corriger avant de les enregistrer."}</DialogDescription>
        </DialogHeader>

        {!result && (
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) void upload(f); }}
              className={cn("flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition-colors", dragging ? "border-primary bg-muted" : "hover:bg-muted/50")}
            >
              {busy ? <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" aria-hidden /> : <FileUp className="h-7 w-7 text-muted-foreground" aria-hidden />}
              <span className="font-medium">{busy ? "Analyse du document en cours…" : "Déposez votre fichier ou cliquez pour le choisir"}</span>
              <span className="text-xs text-muted-foreground">PDF, PNG, JPG, DOCX, XLSX ou CSV · 10 Mo maximum · L&apos;ancien format XLS doit être converti</span>
            </button>
            <input ref={input} type="file" accept={ACCEPT} className="hidden" aria-label="Fichier d'emploi du temps" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {result.warnings.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {result.warnings.join(" ")}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="imp-start">À partir du</Label>
                <Input id="imp-start" type="date" className="h-9 w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              {hasHistory && (
                <fieldset className="text-sm">
                  <legend className="mb-1 text-xs text-muted-foreground">Cours déjà présents</legend>
                  <label className="mr-4 inline-flex items-center gap-1.5"><input type="radio" name="mode" checked={mode === "add"} onChange={() => setMode("add")} /> Compléter sans rien changer</label>
                  <label className="inline-flex items-center gap-1.5"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Appliquer les changements</label>
                </fieldset>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun cours détecté. Essayez avec un document plus lisible.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[900px] text-xs">
                  <thead className="bg-muted/60 text-left">
                    <tr>{["État", "Cours", "Rattacher à", "Jour", "Début", "Fin", "Salle", "Enseignant", "Sem.", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className={cn("border-t align-top", r.confidence === "faible" && "bg-amber-500/10", r.status === "identique" && "opacity-60")}>
                        <td className="w-24 px-2 py-1.5">
                          <p className="font-medium">{STATUS_LABEL[r.status]}{r.changes.length ? ` (${r.changes.join(", ")})` : ""}</p>
                          <p className={r.confidence === "faible" ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{CONFIDENCE_LABEL[r.confidence]}</p>
                        </td>
                        <td className="min-w-40 px-1 py-1.5">
                          <input aria-label="Cours" className={fieldCls} value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} />
                          {r.issues.map((x) => <p key={x} className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">{x}</p>)}
                        </td>
                        <td className="min-w-32 px-1 py-1.5">
                          <select aria-label="Matière" className={fieldCls} value={r.subjectChoice ?? ""} onChange={(e) => patch(r.id, { subjectChoice: e.target.value })}>
                            <option value="">Aucune</option>
                            <option value={CREATE}>Créer cette matière</option>
                            {result.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </td>
                        <td className="w-24 px-1 py-1.5">
                          <select aria-label="Jour" className={fieldCls} value={r.day ?? ""} onChange={(e) => patch(r.id, { day: e.target.value ? Number(e.target.value) : null })}>
                            <option value="">—</option>
                            {DAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                          </select>
                        </td>
                        <td className="w-20 px-1 py-1.5"><input aria-label="Début" type="time" className={fieldCls} value={toTimeInput(r.startMinutes)} onChange={(e) => patch(r.id, { startMinutes: fromTimeInput(e.target.value) })} /></td>
                        <td className="w-20 px-1 py-1.5"><input aria-label="Fin" type="time" className={fieldCls} value={toTimeInput(r.endMinutes)} onChange={(e) => patch(r.id, { endMinutes: fromTimeInput(e.target.value) })} /></td>
                        <td className="min-w-20 px-1 py-1.5"><input aria-label="Salle" className={fieldCls} value={r.room ?? ""} onChange={(e) => patch(r.id, { room: e.target.value || null })} /></td>
                        <td className="min-w-24 px-1 py-1.5"><input aria-label="Enseignant" className={fieldCls} value={r.teacher ?? ""} onChange={(e) => patch(r.id, { teacher: e.target.value || null })} /></td>
                        <td className="w-16 px-1 py-1.5">
                          <select aria-label="Semaine" className={fieldCls} value={r.weekPattern} onChange={(e) => patch(r.id, { weekPattern: e.target.value as DraftRow["weekPattern"] })}>
                            <option value="ALL">Toutes</option><option value="A">A</option><option value="B">B</option>
                          </select>
                        </td>
                        <td className="px-1 py-1.5"><button type="button" aria-label={`Retirer ${r.title}`} className="rounded p-1.5 text-destructive hover:bg-muted" onClick={() => setRows((l) => l.filter((x) => x.id !== r.id))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {mode === "replace" && result.removed.length > 0 && (
              <p className="rounded-xl border border-destructive/40 p-3 text-xs">
                <span className="font-semibold">Seront retirés, car absents du nouveau document :</span> {result.removed.map((r) => `${r.title} (${DAY_NAMES[r.day - 1]} ${toTimeInput(r.startMinutes)})`).join(", ")}.
              </p>
            )}
            {incomplete.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{incomplete.length} ligne(s) incomplète(s) : complétez le cours, le jour et les horaires, ou retirez-les.</p>}
          </div>
        )}

        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {result && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => void cancel()}>Annuler</Button>
            <Button disabled={busy || incomplete.length > 0 || rows.length === 0} onClick={() => void confirm()}>{busy ? "Enregistrement…" : "Confirmer l'importation"}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
