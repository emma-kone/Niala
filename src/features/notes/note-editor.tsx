"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import {
  Bold,
  Code,
  Code2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from "lucide-react";
import { api, ApiError } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NOTE_KIND_LABEL, type NoteDetail } from "./types";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
const SAVE_DELAY_MS = 800;

interface Props {
  noteId: string;
  subjectId: string;
  /** Mode compact (panneau du lecteur) : pas de titre de page, contrôles resserrés. */
  compact?: boolean;
  /** Si fourni, un clic sur le lien d'un document est délégué (ex. aller à la page dans le lecteur). */
  onOpenLink?: (link: NoteDetail["links"][number]) => void;
  onSaved?: () => void;
  onChanged?: (note: NoteDetail) => void;
  onDeleted?: () => void;
}

export function NoteEditor(props: Props) {
  // Remonter l'éditeur quand la note change : état de sauvegarde et historique d'annulation propres à chaque note.
  return <EditorInner key={props.noteId} {...props} />;
}

function EditorInner({ noteId, subjectId, compact, onOpenLink, onSaved, onChanged, onDeleted }: Props) {
  const [note, setNote] = useState<NoteDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);

  const revision = useRef(1);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const titleRef = useRef("");
  const dirty = useRef<{ title: boolean; content: boolean }>({ title: false, content: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const stateRef = useRef<SaveState>("saved");
  stateRef.current = save;
  const currentState = () => stateRef.current as SaveState;

  const flush = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current.title && !dirty.current.content) return;
    if (currentState() === "conflict") return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    const body: Record<string, unknown> = { revision: revision.current };
    const sent = { ...dirty.current };
    if (sent.title) body.title = titleRef.current;
    if (sent.content && editorRef.current) body.content = editorRef.current.getJSON();
    dirty.current = { title: false, content: false };
    inFlight.current = true;
    setSave("saving");
    try {
      const res = await api.patch<{ revision: number }>(`/api/notes/${noteId}`, body);
      revision.current = res.revision;
      const stillDirty = dirty.current.title || dirty.current.content;
      setSave(stillDirty ? "dirty" : "saved");
      setSaveError(null);
      onSaved?.();
    } catch (e) {
      // on remet les changements en attente : rien n'est perdu
      dirty.current = { title: dirty.current.title || sent.title, content: dirty.current.content || sent.content };
      if (e instanceof ApiError && e.status === 409) setSave("conflict");
      else {
        setSave("error");
        setSaveError(e instanceof Error ? e.message : "Enregistrement impossible.");
      }
    } finally {
      inFlight.current = false;
      if (queued.current && currentState() !== "conflict" && currentState() !== "error") {
        queued.current = false;
        void flush();
      }
    }
  }, [noteId, onSaved]);

  const schedule = useCallback(() => {
    setSave((s) => (s === "conflict" ? s : "dirty"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true } }),
      Table,
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: "Écrivez votre note…" }),
    ],
    editorProps: {
      attributes: { class: "sf-prose min-h-40 px-4 py-3 focus:outline-none", "aria-label": "Contenu de la note" },
    },
    onUpdate: () => {
      dirty.current.content = true;
      schedule();
    },
  });
  editorRef.current = editor;

  // Chargement
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ note: NoteDetail }>(`/api/notes/${noteId}`)
      .then((r) => {
        if (cancelled) return;
        setNote(r.note);
        setTitle(r.note.title);
        titleRef.current = r.note.title;
        revision.current = r.note.revision;
        onChanged?.(r.note);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "Note introuvable."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  useEffect(() => {
    if (editor && note) editor.commands.setContent(note.content, { emitUpdate: false });
  }, [editor, note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get<{ documents: { id: string; name: string }[] }>(`/api/subjects/${subjectId}/documents`).then((r) => setDocs(r.documents)).catch(() => undefined);
  }, [subjectId]);

  // Enregistrement à la fermeture / au changement de note
  useEffect(() => {
    const onHide = () => {
      if (!dirty.current.title && !dirty.current.content) return;
      if (stateRef.current === "conflict") return;
      const body: Record<string, unknown> = { revision: revision.current };
      if (dirty.current.title) body.title = titleRef.current;
      if (dirty.current.content && editorRef.current) body.content = editorRef.current.getJSON();
      void fetch(`/api/notes/${noteId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true, credentials: "same-origin" }).catch(() => undefined);
      dirty.current = { title: false, content: false };
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [noteId]);

  async function reload() {
    const r = await api.get<{ note: NoteDetail }>(`/api/notes/${noteId}`);
    dirty.current = { title: false, content: false };
    revision.current = r.note.revision;
    setNote(r.note);
    setTitle(r.note.title);
    titleRef.current = r.note.title;
    editor?.commands.setContent(r.note.content, { emitUpdate: false });
    setSave("saved");
  }

  async function keepMine() {
    try {
      const r = await api.get<{ note: NoteDetail }>(`/api/notes/${noteId}`);
      revision.current = r.note.revision;
    } catch {
      return;
    }
    dirty.current = { title: true, content: true };
    stateRef.current = "dirty";
    setSave("dirty");
    void flush();
  }

  async function addLink(documentId: string) {
    const r = await api.post<{ note: NoteDetail }>(`/api/notes/${noteId}/links`, { documentId });
    setNote((n) => (n ? { ...n, links: r.note.links, kind: r.note.kind } : n));
    onChanged?.(r.note);
  }
  async function removeLink(linkId: string) {
    const r = await api.del<{ note: NoteDetail }>(`/api/notes/${noteId}/links/${linkId}`);
    setNote((n) => (n ? { ...n, links: r.note.links, kind: r.note.kind } : n));
    onChanged?.(r.note);
  }
  async function remove() {
    if (!window.confirm("Supprimer définitivement cette note ?")) return;
    dirty.current = { title: false, content: false };
    await api.del(`/api/notes/${noteId}`);
    onDeleted?.();
  }

  if (loadError) return <p role="alert" className="p-4 text-sm text-destructive">{loadError}</p>;
  if (!note) return <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement de la note…</div>;

  const linkable = docs.filter((d) => !note.links.some((l) => l.documentId === d.id));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{NOTE_KIND_LABEL[note.kind]}</span>
        <SaveBadge state={save} error={saveError} onRetry={() => { stateRef.current = "dirty"; setSave("dirty"); void flush(); }} />
        <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 text-destructive" onClick={() => void remove()} aria-label="Supprimer la note">
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      {save === "conflict" && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Cette note a été modifiée ailleurs.
          <Button size="sm" variant="outline" className="bg-background" onClick={() => void reload()}>Recharger la version enregistrée</Button>
          <Button size="sm" variant="outline" className="bg-background" onClick={() => void keepMine()}>Conserver ma version</Button>
        </div>
      )}

      <div className={cn("space-y-2 px-3 pt-3", compact && "pt-2")}>
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            dirty.current.title = true;
            schedule();
          }}
          placeholder="Titre de la note"
          aria-label="Titre de la note"
          maxLength={200}
          className={cn("border-0 px-1 font-semibold shadow-none focus-visible:ring-0", compact ? "h-8 text-sm" : "h-10 text-lg")}
        />
        <LinkedDocs subjectId={subjectId} note={note} linkable={linkable} onAdd={addLink} onRemove={removeLink} onOpen={onOpenLink} />
      </div>

      <Toolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function SaveBadge({ state, error, onRetry }: { state: SaveState; error: string | null; onRetry: () => void }) {
  const label = { saved: "Enregistré", dirty: "Modifications en attente…", saving: "Enregistrement…", error: "Échec de l'enregistrement", conflict: "Conflit" }[state];
  return (
    <span role="status" aria-live="polite" className={cn("flex items-center gap-1.5 text-xs", state === "error" || state === "conflict" ? "text-destructive" : "text-muted-foreground")} title={error ?? undefined}>
      {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
      {label}
      {state === "error" && (
        <button type="button" onClick={onRetry} className="underline">
          Réessayer
        </button>
      )}
    </span>
  );
}

function LinkedDocs({
  subjectId,
  note,
  linkable,
  onAdd,
  onRemove,
  onOpen,
}: {
  subjectId: string;
  note: NoteDetail;
  linkable: { id: string; name: string }[];
  onAdd: (id: string) => Promise<void>;
  onRemove: (linkId: string) => Promise<void>;
  onOpen?: (link: NoteDetail["links"][number]) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {note.links.map((l) => {
        const href = `${routes.subject(subjectId)}/documents/${l.documentId}${l.page ? `?page=${l.page}` : ""}`;
        const label = `${l.documentName}${l.page ? ` · p. ${l.page}` : ""}`;
        return (
          <span key={l.id} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-0.5 pl-2 pr-1 text-xs">
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            {onOpen ? (
              <button type="button" onClick={() => onOpen(l)} className="truncate hover:underline">{label}</button>
            ) : (
              <Link href={href} className="truncate hover:underline">{label}</Link>
            )}
            <button type="button" onClick={() => void onRemove(l.id)} aria-label={`Retirer le lien vers ${l.documentName}`} className="rounded-full p-0.5 hover:bg-muted">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </span>
        );
      })}
      {linkable.length > 0 && (
        <Select
          value={value}
          onValueChange={(v) => {
            setValue("");
            void onAdd(v);
          }}
        >
          <SelectTrigger className="h-7 w-auto gap-1 rounded-full px-2.5 text-xs" aria-label="Lier à un document">
            <SelectValue placeholder="+ Lier à un document" />
          </SelectTrigger>
          <SelectContent>
            {linkable.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"), strike: e.isActive("strike"), code: e.isActive("code"),
            h1: e.isActive("heading", { level: 1 }), h2: e.isActive("heading", { level: 2 }), h3: e.isActive("heading", { level: 3 }),
            bullet: e.isActive("bulletList"), ordered: e.isActive("orderedList"), quote: e.isActive("blockquote"), codeBlock: e.isActive("codeBlock"),
            link: e.isActive("link"), table: e.isActive("table"),
            canUndo: e.can().undo(), canRedo: e.can().redo(),
          }
        : null,
  });
  if (!editor || !s) return <div className="h-10 border-y" aria-hidden />;
  const B = ({ on, label, active, disabled, children }: { on: () => void; label: string; active?: boolean; disabled?: boolean; children: React.ReactNode }) => (
    <Button type="button" variant={active ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onMouseDown={(e) => e.preventDefault()} onClick={on} aria-label={label} title={label} aria-pressed={active} disabled={disabled}>
      {children}
    </Button>
  );
  const chain = () => editor.chain().focus();
  const setLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Adresse du lien (https://…)", prev ?? "https://");
    if (url === null) return;
    if (url.trim() === "") return void chain().extendMarkRange("link").unsetLink().run();
    chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  return (
    <div role="toolbar" aria-label="Mise en forme" className="flex flex-wrap items-center gap-0.5 border-y bg-muted/30 px-2 py-1">
      <B on={() => chain().undo().run()} label="Annuler" disabled={!s.canUndo}><Undo2 className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().redo().run()} label="Rétablir" disabled={!s.canRedo}><Redo2 className="h-4 w-4" aria-hidden /></B>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <B on={() => chain().toggleHeading({ level: 1 }).run()} label="Titre 1" active={s.h1}><Heading1 className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleHeading({ level: 2 }).run()} label="Titre 2" active={s.h2}><Heading2 className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleHeading({ level: 3 }).run()} label="Titre 3" active={s.h3}><Heading3 className="h-4 w-4" aria-hidden /></B>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <B on={() => chain().toggleBold().run()} label="Gras" active={s.bold}><Bold className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleItalic().run()} label="Italique" active={s.italic}><Italic className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleUnderline().run()} label="Souligné" active={s.underline}><UnderlineIcon className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleStrike().run()} label="Barré" active={s.strike}><Strikethrough className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleCode().run()} label="Code en ligne" active={s.code}><Code className="h-4 w-4" aria-hidden /></B>
      <B on={setLink} label="Lien" active={s.link}><Link2 className="h-4 w-4" aria-hidden /></B>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <B on={() => chain().toggleBulletList().run()} label="Liste à puces" active={s.bullet}><List className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleOrderedList().run()} label="Liste numérotée" active={s.ordered}><ListOrdered className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleBlockquote().run()} label="Citation" active={s.quote}><Quote className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().toggleCodeBlock().run()} label="Bloc de code" active={s.codeBlock}><Code2 className="h-4 w-4" aria-hidden /></B>
      <B on={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="Insérer un tableau" active={s.table}><Table2 className="h-4 w-4" aria-hidden /></B>
      {s.table && (
        <>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addRowAfter().run()}>+ ligne</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().addColumnAfter().run()}>+ colonne</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteRow().run()}>− ligne</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteColumn().run()}>− colonne</Button>
          <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-destructive" onMouseDown={(e) => e.preventDefault()} onClick={() => chain().deleteTable().run()}>Supprimer le tableau</Button>
        </>
      )}
    </div>
  );
}
