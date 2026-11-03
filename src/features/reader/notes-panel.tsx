"use client";

import { useState } from "react";
import { ArrowLeft, FilePlus2, Highlighter, Loader2, StickyNote } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NoteEditor } from "@/features/notes/note-editor";
import { NOTE_KIND_LABEL, type NoteListItem } from "@/features/notes/types";

interface Props {
  subjectId: string;
  docId: string;
  notes: NoteListItem[] | null;
  error: string | null;
  currentPage: number;
  activeId: string | null;
  onActivate: (note: NoteListItem | null) => void;
  onReload: () => void;
  onGoToPage: (page: number) => void;
}

/** Notes liées au document ouvert : annotations de passage (triées par page) et notes de document. */
export function NotesPanel({ subjectId, docId, notes, error, currentPage, activeId, onActivate, onReload, onGoToPage }: Props) {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function createHere() {
    setCreating(true);
    setCreateError(null);
    try {
      const r = await api.post<{ note: NoteListItem }>(`/api/subjects/${subjectId}/notes`, {
        links: [{ documentId: docId, page: currentPage }],
      });
      onReload();
      onActivate(r.note);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Création impossible.");
    } finally {
      setCreating(false);
    }
  }

  if (activeId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Button variant="ghost" size="sm" className="m-2 w-fit gap-1" onClick={() => onActivate(null)}>
          <ArrowLeft className="h-4 w-4" aria-hidden /> Notes du document
        </Button>
        <div className="min-h-0 flex-1">
          <NoteEditor
            noteId={activeId}
            subjectId={subjectId}
            compact
            onSaved={onReload}
            onChanged={onReload}
            onOpenLink={(l) => l.documentId === docId && l.page && onGoToPage(l.page)}
            onDeleted={() => {
              onActivate(null);
              onReload();
            }}
          />
        </div>
      </div>
    );
  }

  const mine = (n: NoteListItem) => n.links.find((l) => l.documentId === docId);
  const sorted = [...(notes ?? [])].sort((a, b) => (mine(a)?.page ?? 9e9) - (mine(b)?.page ?? 9e9) || +new Date(b.updatedAt) - +new Date(a.updatedAt));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b p-3">
        <Button className="w-full gap-2" onClick={() => void createHere()} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FilePlus2 className="h-4 w-4" aria-hidden />}
          Nouvelle note (page {currentPage})
        </Button>
        {createError && <p role="alert" className="mt-2 text-xs text-destructive">{createError}</p>}
        <p className="typo-meta mt-2">Astuce : sélectionnez un passage du PDF puis « Annoter ce passage ».</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && <p role="alert" className="text-sm text-destructive">{error} <button className="underline" onClick={onReload}>Réessayer</button></p>}
        {!notes && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…</p>}
        {notes?.length === 0 && <p className="typo-subtitle">Aucune note sur ce document pour l&apos;instant.</p>}
        <ul className="space-y-2">
          {sorted.map((n) => {
            const link = mine(n);
            const annotation = n.kind === "ANNOTATION";
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onActivate(n)}
                  className={cn("w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50")}
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {annotation ? <Highlighter className="h-3.5 w-3.5 text-amber-500" aria-hidden /> : <StickyNote className="h-3.5 w-3.5" aria-hidden />}
                    {NOTE_KIND_LABEL[n.kind]}
                    {link?.page ? <span className="ml-auto font-medium">p. {link.page}</span> : null}
                  </div>
                  {n.title && <p className="mt-1 text-sm font-semibold">{n.title}</p>}
                  {annotation && link?.anchor?.quote && <p className="mt-1 line-clamp-2 border-l-2 border-amber-400 pl-2 text-xs italic text-muted-foreground">{link.anchor.quote}</p>}
                  {n.snippet && !annotation && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.snippet}</p>}
                  {annotation && n.snippet && <p className="mt-1 line-clamp-2 text-xs">{n.snippet.replace(link?.anchor?.quote ?? "", "").trim()}</p>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
