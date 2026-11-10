"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileUp, Loader2, Trash2, X } from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { confirmAction, notify } from "@/components/notifications";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, mondayOf, weekday } from "@/server/domain/schedule";
import { DAY_NAMES, formatDay, fromTimeInput, toTimeInput, type SubjectOption } from "./types";

interface DraftRow {
  id: string;
  code: string | null;
  sessionType: string | null;
  title: string;
  day: number | null;
  date: string | null;
  dates: string[] | null;
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

interface BreakRow {
  label: string;
  startMinutes: number;
  endMinutes: number;
  weekday: number | null;
}

interface SpecialRow {
  id: string;
  label: string;
  kind: "HOLIDAY" | "EXAM" | "SPECIAL";
  startDate: string | null;
  endDate: string | null;
  startMinutes: number | null;
  endMinutes: number | null;
  confidence: "elevee" | "moyenne" | "faible";
  issues: string[];
}

interface ImportResult {
  id: string;
  fileName: string;
  warnings: string[];
  subjects: SubjectOption[];
  events: DraftRow[];
  breaks: BreakRow[];
  specials: SpecialRow[];
  removed: { id: string; title: string; day: number; startMinutes: number; endMinutes: number }[];
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv";
const CREATE = "__create__";
const STATUS_LABEL = { nouveau: "Nouveau", identique: "Déjà présent", modifie: "Modifié" };
const CONFIDENCE_LABEL = { elevee: "Fiable", moyenne: "À vérifier", faible: "Incertain" };
const SPECIAL_LABEL = { HOLIDAY: "Congé", EXAM: "Examens", SPECIAL: "Journée particulière" };
const fieldCls = "h-8 w-full rounded-md border bg-background px-2 text-xs";

/** Dans un document à codes, seule une ligne codée est une matière : sport ou rattrapage ne créent rien par défaut. */
const initialChoice = (e: DraftRow, anyCode: boolean) => e.subjectId ?? (e.title && (e.code || !anyCode) ? CREATE : "");
const shortDate = (d: string) => formatDay(d, { day: "2-digit", month: "2-digit" });

/** Deux lignes du brouillon occupent-elles au moins un même créneau ? */
function clash(a: DraftRow, b: DraftRow) {
  if (a.day === null || a.day !== b.day || a.startMinutes === null || a.endMinutes === null || b.startMinutes === null || b.endMinutes === null) return false;
  if (a.startMinutes >= b.endMinutes || b.startMinutes >= a.endMinutes) return false;
  if (a.weekPattern !== "ALL" && b.weekPattern !== "ALL" && a.weekPattern !== b.weekPattern) return false;
  const da = a.dates ?? (a.date ? [a.date] : null);
  const db = b.dates ?? (b.date ? [b.date] : null);
  return !da || !db || da.some((d) => db.includes(d));
}

/** `target` : emploi du temps affiché, que l'import peut compléter ou mettre à jour ; sinon un nouvel emploi du temps est créé. */
export function ImportDialog({ weekStart, target, onClose, onDone }: { weekStart: string; target?: { id: string; label: string } | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [breaks, setBreaks] = useState<BreakRow[]>([]);
  const [specials, setSpecials] = useState<SpecialRow[]>([]);
  const [startDate, setStartDate] = useState(weekStart);
  const [mode, setMode] = useState<"add" | "replace" | "new">("add");
  const [label, setLabel] = useState("");
  const [activate, setActivate] = useState(true);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (target) form.append("scheduleId", target.id);
      const r = await api.post<ImportResult>("/api/agenda/imports", form);
      setResult(r);
      setRows(r.events.map((e) => ({ ...e, subjectChoice: initialChoice(e, r.events.some((x) => x.code)) })));
      setBreaks(r.breaks);
      setSpecials(r.specials);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, values: Partial<DraftRow>) => setRows((list) => list.map((r) => (r.id === id ? { ...r, ...values } : r)));
  const patchSpecial = (id: string, values: Partial<SpecialRow>) => setSpecials((list) => list.map((s) => (s.id === id ? { ...s, ...values } : s)));

  /** Change le jour d'un cours : ses dates suivent, dans les mêmes semaines. */
  function changeDay(r: DraftRow, day: number | null) {
    if (day === null) return patch(r.id, { day });
    const move = (d: string) => addDays(mondayOf(d), day - 1);
    patch(r.id, { day, dates: r.dates?.map(move) ?? null, date: r.date ? move(r.date) : null });
  }

  /** Retire une date : le cours redevient ponctuel s'il n'en reste qu'une. */
  function removeDate(r: DraftRow, date: string) {
    const left = (r.dates ?? []).filter((d) => d !== date);
    patch(r.id, left.length > 1 ? { dates: left } : { dates: null, date: left[0] ?? null, recurring: false });
  }

  async function cancel() {
    if (result) await api.del(`/api/agenda/imports/${result.id}`).catch(() => undefined);
    onClose();
  }

  const incomplete = rows.filter((r) => !r.title.trim() || r.day === null || r.startMinutes === null || r.endMinutes === null);
  const clashes = useMemo(() => new Map(rows.map((r) => [r.id, rows.find((o) => o.id !== r.id && clash(r, o))?.title ?? null])), [rows]);
  const summary = [
    { label: "Fiables", n: rows.filter((r) => r.confidence === "elevee" && !r.issues.length).length, warn: false },
    { label: "Incertains", n: rows.filter((r) => r.confidence !== "elevee").length, warn: true },
    { label: "Horaires ou champs incomplets", n: incomplete.length, warn: true },
    { label: "Chevauchements", n: [...clashes.values()].filter(Boolean).length, warn: true },
    { label: "Matières à créer ou à rattacher", n: rows.filter((r) => r.title && !r.subjectId && r.code).length, warn: false },
    { label: "Dates ambiguës", n: rows.filter((r) => r.issues.some((i) => i.includes("ambiguë"))).length + specials.filter((s) => !s.startDate).length, warn: true },
  ];
  const needsStart = rows.some((r) => !r.dates?.length && !r.date);
  const hasHistory = !!result && (result.removed.length > 0 || rows.some((r) => r.status !== "nouveau"));

  async function confirm(force = false) {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const events = rows.map((r) => ({
        id: r.id,
        title: r.title.trim(),
        code: r.code,
        sessionType: r.sessionType,
        day: r.day,
        date: r.date,
        dates: r.dates,
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
      const payload = {
        mode: hasHistory ? mode : "new",
        ...(hasHistory && mode !== "new" && target ? { scheduleId: target.id } : {}),
        ...((hasHistory ? mode : "new") === "new" ? { label: label.trim() || result.fileName.replace(/\.[^.]+$/, ""), activate } : {}),
        startDate,
        events,
        force,
        breaks: breaks.map(({ label, startMinutes, endMinutes, weekday: w }) => ({ label, startMinutes, endMinutes, weekday: w })),
        specials: specials.filter((s) => s.startDate && s.endDate).map(({ label, kind, startDate: from, endDate, startMinutes, endMinutes }) => ({ label, kind, startDate: from, endDate, startMinutes, endMinutes })),
      };
      const done = await api.post<{ created: number; updated: number; removed: number; skipped: number }>(`/api/agenda/imports/${result.id}/confirm`, payload);
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
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto", result ? "sm:max-w-6xl" : "sm:max-w-lg")}>
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
            <ul aria-label="Résumé de la lecture" className="flex flex-wrap gap-1.5">
              {summary.map((s) => <li key={s.label} className={cn("rounded-full border px-2.5 py-0.5 text-xs", s.warn && s.n > 0 && "border-amber-500/60 bg-amber-500/10 font-medium")}>{s.label} : <span className="tnum font-semibold">{s.n}</span></li>)}
            </ul>
            {result.warnings.length > 0 && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {result.warnings.join(" ")}
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3">
              {needsStart && (
                <div className="space-y-1">
                  <Label htmlFor="imp-start">À partir du</Label>
                  <Input id="imp-start" type="date" className="h-9 w-40" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
              )}
              {hasHistory && (
                <fieldset className="text-sm">
                  <legend className="mb-1 text-xs text-muted-foreground">Enregistrer ce document</legend>
                  <label className="mr-4 inline-flex items-center gap-1.5"><input type="radio" name="mode" checked={mode === "add"} onChange={() => setMode("add")} /> Compléter « {target?.label ?? "l'emploi du temps suivi"} »</label>
                  <label className="mr-4 inline-flex items-center gap-1.5"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Le mettre à jour (appliquer les changements)</label>
                  <label className="inline-flex items-center gap-1.5"><input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} /> Nouvel emploi du temps séparé</label>
                </fieldset>
              )}
              {(!hasHistory || mode === "new") && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="imp-label">Nom de l&apos;emploi du temps</Label>
                    <Input id="imp-label" className="h-9 w-56" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={result.fileName.replace(/\.[^.]+$/, "")} />
                  </div>
                  <label className="inline-flex h-9 items-center gap-1.5 text-sm"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Suivre cet emploi du temps</label>
                </div>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun cours détecté. Essayez avec un document plus lisible.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[1040px] text-xs">
                  <thead className="bg-muted/60 text-left">
                    <tr>{["État", "Cours", "Rattacher à", "Type", "Jour", "Début", "Fin", "Salle", "Enseignant", "Séances", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const other = clashes.get(r.id);
                      return (
                        <tr key={r.id} className={cn("border-t align-top", r.confidence === "faible" && "bg-amber-500/10", r.status === "identique" && "opacity-60")}>
                          <td className="w-24 px-2 py-1.5">
                            <p className="font-medium">{STATUS_LABEL[r.status]}{r.changes.length ? ` (${r.changes.join(", ")})` : ""}</p>
                            <p className={r.confidence === "faible" ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{CONFIDENCE_LABEL[r.confidence]}</p>
                          </td>
                          <td className="min-w-44 px-1 py-1.5">
                            <input aria-label="Cours" className={fieldCls} value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} />
                            {r.code && <p className="mt-0.5 text-[11px] text-muted-foreground">Code {r.code}</p>}
                            {r.notes && <p className="mt-0.5 text-[11px] text-muted-foreground">{r.notes}</p>}
                            {other && !r.issues.some((x) => x.startsWith("Chevauche")) && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">Chevauche « {other} ».</p>}
                            {r.issues.map((x) => <p key={x} className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">{x}</p>)}
                          </td>
                          <td className="min-w-32 px-1 py-1.5">
                            <select aria-label="Matière" className={fieldCls} value={r.subjectChoice ?? ""} onChange={(e) => patch(r.id, { subjectChoice: e.target.value })}>
                              <option value="">Aucune</option>
                              <option value={CREATE}>Créer cette matière</option>
                              {result.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </td>
                          <td className="w-16 px-1 py-1.5"><input aria-label="Type" placeholder="CM, TD…" maxLength={20} className={fieldCls} value={r.sessionType ?? ""} onChange={(e) => patch(r.id, { sessionType: e.target.value || null })} /></td>
                          <td className="w-24 px-1 py-1.5">
                            <select aria-label="Jour" className={fieldCls} value={r.day ?? ""} onChange={(e) => changeDay(r, e.target.value ? Number(e.target.value) : null)}>
                              <option value="">—</option>
                              {DAY_NAMES.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                            </select>
                          </td>
                          <td className="w-20 px-1 py-1.5"><input aria-label="Début" type="time" className={fieldCls} value={toTimeInput(r.startMinutes)} onChange={(e) => patch(r.id, { startMinutes: fromTimeInput(e.target.value) })} /></td>
                          <td className="w-20 px-1 py-1.5"><input aria-label="Fin" type="time" className={fieldCls} value={toTimeInput(r.endMinutes)} onChange={(e) => patch(r.id, { endMinutes: fromTimeInput(e.target.value) })} /></td>
                          <td className="min-w-20 px-1 py-1.5"><input aria-label="Salle" className={fieldCls} value={r.room ?? ""} onChange={(e) => patch(r.id, { room: e.target.value || null })} /></td>
                          <td className="min-w-24 px-1 py-1.5"><input aria-label="Enseignant" className={fieldCls} value={r.teacher ?? ""} onChange={(e) => patch(r.id, { teacher: e.target.value || null })} /></td>
                          <td className="min-w-36 px-1 py-1.5">
                            {r.dates?.length ? (
                              <details>
                                <summary className="cursor-pointer font-medium">{r.dates.length} dates</summary>
                                <ul className="mt-1 flex flex-wrap gap-1">
                                  {r.dates.map((d) => <li key={d} className="tnum flex items-center gap-0.5 rounded bg-muted px-1">{shortDate(d)}<button type="button" aria-label={`Retirer le ${shortDate(d)}`} onClick={() => removeDate(r, d)}><X className="h-3 w-3" aria-hidden /></button></li>)}
                                </ul>
                              </details>
                            ) : r.date ? (
                              <input aria-label="Date" type="date" className={fieldCls} value={r.date} onChange={(e) => e.target.value && patch(r.id, { date: e.target.value, day: weekday(e.target.value) })} />
                            ) : (
                              <select aria-label="Semaine" className={fieldCls} value={r.weekPattern} onChange={(e) => patch(r.id, { weekPattern: e.target.value as DraftRow["weekPattern"] })}>
                                <option value="ALL">Chaque semaine</option><option value="A">Semaines A</option><option value="B">Semaines B</option>
                              </select>
                            )}
                          </td>
                          <td className="px-1 py-1.5"><button type="button" aria-label={`Retirer ${r.title}`} className="rounded p-1.5 text-destructive hover:bg-muted" onClick={() => setRows((l) => l.filter((x) => x.id !== r.id))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <section aria-label="Pauses déduites" className="rounded-xl border p-3">
                <h3 className="text-sm font-semibold">Pauses déduites des horaires</h3>
                {breaks.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Aucune pause répétée dans ce document.</p>}
                <ul className="mt-1 space-y-1">
                  {breaks.map((b, i) => (
                    <li key={`${b.startMinutes}-${b.endMinutes}-${b.weekday}`} className="grid grid-cols-[1fr_5.5rem_5.5rem_5.5rem_auto] items-center gap-1 text-xs">
                      <input aria-label="Nom de la pause" className={fieldCls} value={b.label} maxLength={60} onChange={(e) => setBreaks((l) => l.map((x, n) => (n === i ? { ...x, label: e.target.value } : x)))} />
                      <input aria-label="Début" type="time" className={fieldCls} value={toTimeInput(b.startMinutes)} onChange={(e) => { const m = fromTimeInput(e.target.value); if (m !== null) setBreaks((l) => l.map((x, n) => (n === i ? { ...x, startMinutes: m } : x))); }} />
                      <input aria-label="Fin" type="time" className={fieldCls} value={toTimeInput(b.endMinutes)} onChange={(e) => { const m = fromTimeInput(e.target.value); if (m !== null) setBreaks((l) => l.map((x, n) => (n === i ? { ...x, endMinutes: m } : x))); }} />
                      <select aria-label="Jour de la pause" className={fieldCls} value={b.weekday ?? ""} onChange={(e) => setBreaks((l) => l.map((x, n) => (n === i ? { ...x, weekday: e.target.value ? Number(e.target.value) : null } : x)))}>
                        <option value="">Tous</option>
                        {DAY_NAMES.map((d, n) => <option key={d} value={n + 1}>{d}</option>)}
                      </select>
                      <button type="button" aria-label={`Retirer ${b.label}`} className="rounded p-1.5 text-destructive hover:bg-muted" onClick={() => setBreaks((l) => l.filter((_, n) => n !== i))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                    </li>
                  ))}
                </ul>
              </section>
              <section aria-label="Périodes particulières" className="rounded-xl border p-3">
                <h3 className="text-sm font-semibold">Périodes particulières</h3>
                {specials.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Aucun congé, examen ou journée particulière détecté.</p>}
                <ul className="mt-1 space-y-1.5">
                  {specials.map((s) => (
                    <li key={s.id} className="text-xs">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-1">
                        <input aria-label="Nom de la période" className={fieldCls} value={s.label} maxLength={160} onChange={(e) => patchSpecial(s.id, { label: e.target.value })} />
                        <button type="button" aria-label={`Retirer ${s.label}`} className="rounded p-1.5 text-destructive hover:bg-muted" onClick={() => setSpecials((l) => l.filter((x) => x.id !== s.id))}><Trash2 className="h-3.5 w-3.5" aria-hidden /></button>
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        <select aria-label="Nature" className={fieldCls} value={s.kind} onChange={(e) => patchSpecial(s.id, { kind: e.target.value as SpecialRow["kind"] })}>{Object.entries(SPECIAL_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                        <input aria-label="Du" type="date" className={fieldCls} value={s.startDate ?? ""} onChange={(e) => patchSpecial(s.id, { startDate: e.target.value || null, endDate: s.endDate ?? (e.target.value || null) })} />
                        <input aria-label="Au" type="date" className={fieldCls} value={s.endDate ?? ""} onChange={(e) => patchSpecial(s.id, { endDate: e.target.value || null })} />
                      </div>
                      {s.startMinutes !== null && (
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          <input aria-label="Heure de début" type="time" className={fieldCls} value={toTimeInput(s.startMinutes)} onChange={(e) => patchSpecial(s.id, { startMinutes: fromTimeInput(e.target.value) ?? s.startMinutes })} />
                          <input aria-label="Heure de fin" type="time" className={fieldCls} value={toTimeInput(s.endMinutes)} onChange={(e) => patchSpecial(s.id, { endMinutes: fromTimeInput(e.target.value) ?? s.endMinutes })} />
                        </div>
                      )}
                      {!s.startDate && <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">Dates à compléter, sinon cette période ne sera pas enregistrée.</p>}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {hasHistory && mode === "new" && <p className="text-xs text-muted-foreground">Emploi du temps séparé : tous les cours ci-dessus y sont enregistrés, sans modifier vos autres emplois du temps. Vous choisissez dans l&apos;agenda celui à suivre.</p>}
            {hasHistory && mode === "replace" && result.removed.length > 0 && (
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
