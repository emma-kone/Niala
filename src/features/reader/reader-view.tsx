"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Info, ListTree, Loader2, PanelRightClose, PanelRightOpen, StickyNote } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Properties } from "@/features/subject-files/properties";
import { STATUS_LABEL, type DocumentDetails } from "@/features/subject-files/types";
import { ExtractedTextViewer, OriginalTextViewer } from "./text-viewers";
import { NotesPanel } from "./notes-panel";
import { AnalysisPanel } from "./analysis-panel";
import type { NoteListItem } from "@/features/notes/types";
import type { PdfAnnotation, PdfSelection } from "./pdf-viewer";

// pdf.js dépend du navigateur : jamais rendu côté serveur
const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement du lecteur…
    </div>
  ),
});

/** Une seule instance du panneau (aside OU feuille) : deux éditeurs sur la même note se concurrenceraient. */
function useDesktop() {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return desktop;
}

/** Enregistre la page lue (différé), et l'envoie aussi à la fermeture de l'onglet. */
function useReadingSaver(docId: string) {
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const page = pending.current;
    if (page == null) return;
    pending.current = null;
    void fetch(`/api/files/${docId}/reading`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page }),
      credentials: "same-origin",
      keepalive: true,
    }).catch(() => undefined);
  }, [docId]);

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  return useCallback(
    (page: number) => {
      pending.current = page;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 1500);
    },
    [flush]
  );
}

export default function ReaderView({ subjectId, docId }: { subjectId: string; docId: string }) {
  const params = useSearchParams();
  const [doc, setDoc] = useState<DocumentDetails | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [panel, setPanel] = useState(true);
  const [pdfPages, setPdfPages] = useState<number | null>(null);
  const saveReading = useReadingSaver(docId);

  // Notes du document + annotations affichées dans le PDF
  const [tab, setTab] = useState<"doc" | "notes" | "analysis">("notes");
  const [sheet, setSheet] = useState(false);
  const desktop = useDesktop();
  const [notes, setNotes] = useState<NoteListItem[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [navigate, setNavigate] = useState<{ page: number; nonce: number } | null>(null);

  const savePage = useCallback(
    (p: number) => {
      setCurrentPage(p);
      saveReading(p);
    },
    [saveReading]
  );

  const reloadNotes = useCallback(async () => {
    try {
      const r = await api.get<{ notes: NoteListItem[] }>(`/api/subjects/${subjectId}/notes?documentId=${docId}`);
      setNotes(r.notes);
      setNotesError(null);
    } catch (e) {
      setNotesError(e instanceof Error ? e.message : "Notes indisponibles.");
    }
  }, [subjectId, docId]);

  useEffect(() => {
    void reloadNotes();
  }, [reloadNotes]);

  const goToPage = useCallback((page: number) => setNavigate((n) => ({ page, nonce: (n?.nonce ?? 0) + 1 })), []);

  const activate = useCallback(
    (note: NoteListItem | null) => {
      setActiveNoteId(note?.id ?? null);
      const page = note?.links.find((l) => l.documentId === docId)?.page;
      if (page) goToPage(page);
    },
    [docId, goToPage]
  );

  const annotations: PdfAnnotation[] = (notes ?? []).flatMap((n) =>
    n.links
      .filter((l) => l.documentId === docId && l.page && l.anchor?.rects?.length)
      .map((l) => ({ id: n.id, page: l.page as number, rects: l.anchor!.rects! }))
  );

  const annotate = useCallback(
    async (sel: PdfSelection) => {
      setTab("notes");
      setSheet(true);
      setPanel(true);
      try {
        const r = await api.post<{ note: NoteListItem }>(`/api/subjects/${subjectId}/notes`, {
          links: [{ documentId: docId, page: sel.page, anchor: { quote: sel.quote, rects: sel.rects } }],
        });
        await reloadNotes();
        setActiveNoteId(r.note.id);
      } catch (e) {
        setNotesError(e instanceof Error ? e.message : "Annotation impossible.");
      }
    },
    [subjectId, docId, reloadNotes]
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get<{ document: DocumentDetails }>(`/api/files/${docId}`);
      if (res.document.subjectId !== subjectId) throw Object.assign(new Error("Document introuvable."), { status: 404 });
      setDoc(res.document);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Chargement impossible.", status: (e as { status?: number }).status });
    }
  }, [docId, subjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = doc?.folderId ? `${routes.subject(subjectId)}?dossier=${doc.folderId}` : routes.subject(subjectId);

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">{error.status === 404 ? "Document introuvable" : "Chargement impossible"}</h1>
        <p className="typo-subtitle mt-2">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" asChild>
            <Link href={routes.subject(subjectId)}>Retour à la matière</Link>
          </Button>
          {error.status !== 404 && <Button onClick={() => void load()}>Réessayer</Button>}
        </div>
      </div>
    );
  }

  const contentUrl = `/api/files/${docId}/content`;
  const downloadUrl = `${contentUrl}?download=1`;
  const requestedPage = Number(params.get("page"));
  const startPage = requestedPage > 0 ? requestedPage : (doc?.lastPage ?? 1);
  const status = doc ? STATUS_LABEL[doc.status] : null;

  let viewer: React.ReactNode = <Skeleton className="m-4 h-[70%] rounded-lg" />;
  if (doc) {
    if (!doc.originalMissing && doc.kind === "pdf") {
      viewer = (
        <PdfViewer
          src={contentUrl}
          downloadUrl={downloadUrl}
          fileName={doc.originalName}
          initialPage={startPage}
          onPageChange={savePage}
          onLoaded={setPdfPages}
          annotations={annotations}
          activeAnnotationId={activeNoteId}
          onAnnotationClick={(id) => {
            setTab("notes");
            setSheet(true);
            setPanel(true);
            setActiveNoteId(id);
          }}
          onAnnotate={annotate}
          navigate={navigate}
        />
      );
    } else if (!doc.originalMissing && (doc.kind === "txt" || doc.kind === "md")) {
      viewer = <OriginalTextViewer src={contentUrl} markdown={doc.kind === "md"} downloadUrl={downloadUrl} />;
    } else {
      viewer = (
        <ExtractedTextViewer
          docId={docId}
          downloadUrl={doc.originalMissing ? null : downloadUrl}
          reason={
            doc.originalMissing
              ? "Le fichier original n'a pas été conservé par l'ancienne version : réimportez-le pour le consulter fidèlement."
              : `Il n'existe pas encore d'aperçu fidèle pour le format ${doc.kind.toUpperCase()}.`
          }
        />
      );
    }
  }

  const panelBody = (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Panneau du document" className="flex border-b">
        {([["notes", "Notes", StickyNote], ["analysis", "Analyse", ListTree], ["doc", "Document", Info]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold", tab === id ? "border-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
            {id === "notes" && notes && notes.length > 0 && <span className="rounded-full bg-muted px-1.5 text-[11px]">{notes.length}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
        {tab === "notes" ? (
          <NotesPanel
            subjectId={subjectId}
            docId={docId}
            notes={notes}
            error={notesError}
            currentPage={currentPage}
            activeId={activeNoteId}
            onActivate={activate}
            onReload={() => void reloadNotes()}
            onGoToPage={goToPage}
          />
        ) : tab === "analysis" ? (
          <AnalysisPanel docId={docId} subjectId={subjectId} onGoToPage={goToPage} />
        ) : (
          <div className="p-4">{doc ? <Properties doc={doc} /> : <Skeleton className="h-40 w-full" />}</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[28rem] flex-col md:h-[calc(100dvh-3.25rem)]">
      <header className="flex items-center gap-3 border-b bg-background px-3 py-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8 shrink-0">
          <Link href={back} aria-label="Retour aux fichiers">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold sm:text-base">{doc?.name ?? <Skeleton className="h-5 w-48" />}</h1>
          {doc && (
            <p className="typo-meta truncate">
              {doc.kind.toUpperCase()}
              {pdfPages ?? doc.pageCount ? ` · ${pdfPages ?? doc.pageCount} page(s)` : ""}
              {doc.folderPath ? ` · ${doc.folderPath}` : ""}
            </p>
          )}
        </div>
        {status && status.tone !== "ok" && (
          <Badge variant="outline" className="hidden font-normal sm:inline-flex">
            {status.label}
          </Badge>
        )}
        <Button variant={panel ? "secondary" : "ghost"} size="icon" className="hidden h-8 w-8 shrink-0 lg:inline-flex" onClick={() => setPanel((v) => !v)} aria-pressed={panel} aria-label={panel ? "Masquer le panneau" : "Afficher le panneau"}>
          {panel ? <PanelRightClose className="h-4 w-4" aria-hidden /> : <PanelRightOpen className="h-4 w-4" aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 lg:hidden" onClick={() => setSheet(true)} aria-label="Ouvrir les notes et propriétés">
          <StickyNote className="h-4 w-4" aria-hidden />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1" aria-label="Document">
          {viewer}
        </main>
        {panel && desktop && (
          <aside aria-label="Panneau du document" className="w-96 shrink-0 border-l bg-background">
            {panelBody}
          </aside>
        )}
      </div>

      <Sheet open={sheet && !desktop} onOpenChange={setSheet}>
        <SheetContent className="w-full p-0 sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>Notes et propriétés</SheetTitle>
            <SheetDescription>Notes liées au document et ses propriétés</SheetDescription>
          </SheetHeader>
          {panelBody}
        </SheetContent>
      </Sheet>
    </div>
  );
}
