"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Check, FileText, Library, Loader2, Paperclip, Square, Upload, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SubjectIcon } from "@/components/subject-icon";
import { uploadFiles, type UploadItem } from "@/features/subject-files/upload";

export interface ContextDocument {
  id: string;
  name: string;
}

export interface SubjectChoice {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
}

export interface RecentDoc extends ContextDocument {
  subjectId: string;
  subjectName: string;
  subjectColor: string;
  subjectIcon: string | null;
}

export interface ComposerHandle {
  focus: () => void;
  /** Place un texte dans le champ, curseur à la fin, sans l'envoyer. */
  prefill: (text: string) => void;
}

const MAX_HEIGHT = 200;
const MAX_DOCUMENTS = 12;
const ALL = "__all__";
const ACCEPTED = ".pdf,.docx,.pptx,.txt,.md";

interface ContextPickerProps {
  subjects: SubjectChoice[];
  subjectId: string;
  onSubject: (id: string) => void;
  /** La matière d'une conversation est fixée à sa création. */
  subjectLocked: boolean;
  recent: RecentDoc[];
  documents: ContextDocument[];
  onDocuments: (docs: ContextDocument[]) => void;
}

/** Choix de ce que l'IA consulte : une matière entière ou des documents précis, y compris un fichier importé à l'instant. */
function ContextPicker({ subjects, subjectId, onSubject, subjectLocked, recent, documents, onDocuments }: ContextPickerProps) {
  const [open, setOpen] = useState(false);
  const [subjectDocs, setSubjectDocs] = useState<ContextDocument[] | null>(null);
  const [upload, setUpload] = useState<UploadItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const subject = subjects.find((s) => s.id === subjectId) ?? null;

  useEffect(() => {
    if (!open || subjectId === ALL) return;
    let cancelled = false;
    api
      .get<{ documents: ContextDocument[] }>(`/api/subjects/${subjectId}/documents`)
      .then((r) => !cancelled && setSubjectDocs(r.documents))
      .catch(() => !cancelled && setSubjectDocs([]));
    return () => {
      cancelled = true;
      setSubjectDocs(null);
    };
  }, [open, subjectId]);

  const selected = new Set(documents.map((d) => d.id));
  const toggle = (doc: ContextDocument) => onDocuments(selected.has(doc.id) ? documents.filter((d) => d.id !== doc.id) : documents.length >= MAX_DOCUMENTS ? documents : [...documents, { id: doc.id, name: doc.name }]);

  async function importFile(file: File) {
    if (subjectId === ALL) return;
    const key = `${file.name}-${Date.now()}`;
    let current: UploadItem = { key, name: file.name, phase: "waiting" };
    setUpload(current);
    await uploadFiles([file], { subjectId, folderId: null }, (_k, patch) => {
      current = { ...current, ...patch };
      setUpload(current);
    }, [key]);
    if (current.phase === "done" && current.documentId) {
      onDocuments([...documents, { id: current.documentId, name: file.name }].slice(0, MAX_DOCUMENTS));
      setUpload(null);
    }
  }

  const docs = subjectId === ALL ? recent : (subjectDocs ?? []);
  const label = documents.length ? `${documents.length} document${documents.length > 1 ? "s" : ""}` : (subject?.name ?? "Tous mes cours");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Choisir les cours consultés" className="inline-flex h-8 max-w-[14rem] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          {subject ? <SubjectIcon icon={subject.icon} name={subject.name} color={subject.color} size="xs" /> : <Library className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 space-y-3 rounded-2xl p-3">
        <div>
          <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{subjectLocked ? "Matière de cette conversation" : "Matière consultée"}</p>
          <div className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
            {[{ id: ALL, name: "Tous mes cours", color: "", icon: null } as SubjectChoice, ...subjects].map((s) => {
              const on = s.id === subjectId;
              return (
                <button key={s.id} type="button" disabled={subjectLocked && !on} aria-pressed={on} onClick={() => { onSubject(s.id); onDocuments([]); }} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors disabled:opacity-40", on ? "border-foreground font-medium" : "border-transparent bg-muted/60 hover:bg-muted")}>
                  {s.id !== ALL && <SubjectIcon icon={s.icon} name={s.name} color={s.color} size="xs" />}
                  <span className="max-w-[9rem] truncate">{s.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <p className="px-1 pb-1 text-[11px] font-medium text-muted-foreground">{subjectId === ALL ? "Documents récents" : "Documents de la matière"}</p>
          <ul className="max-h-44 space-y-px overflow-y-auto">
            {subjectId !== ALL && subjectDocs === null && <li className="px-2 py-1 text-xs text-muted-foreground">Chargement…</li>}
            {docs.length === 0 && (subjectId === ALL || subjectDocs !== null) && <li className="px-2 py-1 text-xs text-muted-foreground">{subjectId === ALL ? "Ouvrez un cours pour le retrouver ici." : "Aucun document dans cette matière."}</li>}
            {docs.map((d) => {
              const on = selected.has(d.id);
              return (
                <li key={d.id}>
                  <button type="button" aria-pressed={on} onClick={() => toggle(d)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted">
                    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on && "border-foreground bg-foreground text-background")}>{on && <Check className="h-3 w-3" aria-hidden />}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="border-t pt-2">
          <input ref={fileInput} type="file" accept={ACCEPTED} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
          <button type="button" disabled={subjectId === ALL || upload?.phase === "sending" || upload?.phase === "processing"} onClick={() => fileInput.current?.click()} title={subjectId === ALL ? "Choisissez d'abord la matière qui recevra le fichier" : undefined} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
            {upload && upload.phase !== "error" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Upload className="h-3.5 w-3.5" aria-hidden />}
            {upload?.phase === "sending" ? "Envoi du fichier…" : upload?.phase === "processing" ? "Lecture du fichier…" : subject ? `Importer un fichier dans ${subject.name}` : "Importer un fichier (choisissez une matière)"}
          </button>
          {upload?.phase === "error" && <p role="alert" className="px-2 pt-1 text-[11px] text-destructive">{upload.message}</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface Props extends Omit<ContextPickerProps, "onDocuments"> {
  scope: "GLOBAL" | "DOCUMENT";
  large: boolean;
  /** Mise en avant sur l'écran d'accueil. */
  hero?: boolean;
  disabled: boolean;
  sending: boolean;
  stopping: boolean;
  onDocuments: (docs: ContextDocument[]) => void;
  onSend: (text: string) => void;
  onStop: () => void;
}

export const ChatComposer = forwardRef<ComposerHandle, Props>(function ChatComposer({ scope, large, hero, disabled, sending, stopping, onSend, onStop, documents, onDocuments, ...picker }, ref) {
  const [value, setValue] = useState("");
  const field = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => field.current?.focus(),
    prefill: (text) => {
      setValue(text);
      requestAnimationFrame(() => {
        field.current?.focus();
        field.current?.setSelectionRange(text.length, text.length);
      });
    },
  }));

  // Le champ suit la hauteur du texte, jusqu'à une limite au-delà de laquelle il défile.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const canSend = !sending && !disabled && (value.trim().length > 0 || documents.length > 0);
  function submit() {
    if (!canSend) return;
    onSend(value.trim() || `Présente-moi l'essentiel ${documents.length > 1 ? "de ces documents" : "de ce document"}.`);
    setValue("");
  }

  return (
    <form
      className={cn("niala-composer", hero && "niala-composer-hero")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {documents.length > 0 && (
        <ul className="flex flex-wrap gap-1 px-3 pt-2.5" aria-label="Documents consultés">
          {documents.map((d) => (
            <li key={d.id} className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-muted py-0.5 pl-2 pr-1 text-xs">
              <FileText className="h-3 w-3 shrink-0" aria-hidden />
              <span className="truncate">{d.name}</span>
              <button type="button" aria-label={`Retirer ${d.name}`} onClick={() => onDocuments(documents.filter((x) => x.id !== d.id))} className="rounded-full p-0.5 hover:bg-background">
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={field}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        maxLength={6000}
        placeholder={scope === "DOCUMENT" ? "Votre question sur ce cours…" : "Posez votre question…"}
        aria-label="Message"
        disabled={disabled}
        className={cn("block w-full resize-none bg-transparent px-4 pt-3 outline-none placeholder:text-muted-foreground disabled:opacity-60", large ? "text-[15px]" : "text-sm")}
        style={{ maxHeight: MAX_HEIGHT }}
      />
      <div className="flex items-center justify-between gap-2 p-2">
        <div className="flex min-w-0 items-center gap-0.5">
          {scope === "GLOBAL" && <ContextPicker {...picker} documents={documents} onDocuments={onDocuments} />}
          {scope === "DOCUMENT" && (
            <span className="inline-flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
              <Paperclip className="h-3 w-3" aria-hidden /> Ce cours uniquement
            </span>
          )}
        </div>
        {sending ? (
          <button type="button" onClick={onStop} disabled={stopping} aria-label="Arrêter la génération" title="Arrêter la génération" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105 disabled:opacity-50">
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button type="submit" disabled={!canSend} aria-label="Envoyer" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:scale-105 disabled:scale-100 disabled:bg-muted disabled:text-muted-foreground">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
});
