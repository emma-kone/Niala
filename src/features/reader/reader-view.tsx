"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Info, Loader2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Properties } from "@/features/subject-files/properties";
import { STATUS_LABEL, type DocumentDetails } from "@/features/subject-files/types";
import { ExtractedTextViewer, OriginalTextViewer } from "./text-viewers";

// pdf.js dépend du navigateur : jamais rendu côté serveur
const PdfViewer = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement du lecteur…
    </div>
  ),
});

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
  const savePage = useReadingSaver(docId);

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
        <PdfViewer src={contentUrl} downloadUrl={downloadUrl} fileName={doc.originalName} initialPage={startPage} onPageChange={savePage} onLoaded={setPdfPages} />
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
        <Button variant={panel ? "secondary" : "ghost"} size="icon" className="h-8 w-8 shrink-0" onClick={() => setPanel((v) => !v)} aria-pressed={panel} aria-label={panel ? "Masquer le panneau" : "Afficher le panneau"}>
          {panel ? <PanelRightClose className="h-4 w-4" aria-hidden /> : <PanelRightOpen className="h-4 w-4" aria-hidden />}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1" aria-label="Document">
          {viewer}
        </main>
        {panel && (
          <aside aria-label="Panneau du document" className="hidden w-80 shrink-0 overflow-y-auto border-l bg-background lg:block">
            <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold">
              <Info className="h-4 w-4" aria-hidden /> Document
            </div>
            <div className="p-4">{doc ? <Properties doc={doc} /> : <Skeleton className="h-40 w-full" />}</div>
          </aside>
        )}
      </div>
    </div>
  );
}
