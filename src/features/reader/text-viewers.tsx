"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Download, Info, Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";

const MAX_CHARS = 1_500_000;

function Loading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement…
    </div>
  );
}

/** Fichier texte ou Markdown ORIGINAL, rendu tel quel en lecture seule (pas de HTML brut). */
export function OriginalTextViewer({ src, markdown, downloadUrl }: { src: string; markdown: boolean; downloadUrl: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    fetch(src, { credentials: "same-origin" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        return r.text();
      })
      .then((t) => !cancelled && setText(t))
      .catch(() => !cancelled && setError("Impossible de charger le fichier."));
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) return <p role="alert" className="p-6 text-sm text-destructive">{error}</p>;
  if (text === null) return <Loading />;
  const truncated = text.length > MAX_CHARS;
  const shown = truncated ? text.slice(0, MAX_CHARS) : text;
  return (
    <div className="h-full overflow-auto bg-muted/40">
      <article className="mx-auto my-4 max-w-3xl rounded-lg bg-background p-6 shadow-sm sm:p-10" aria-label="Contenu du document">
        {markdown ? (
          <div className="space-y-3 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_ul]:list-disc">
            <ReactMarkdown skipHtml>{shown}</ReactMarkdown>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">{shown}</pre>
        )}
        {truncated && (
          <p className="mt-6 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Fichier très long : l&apos;affichage est tronqué.{" "}
            <a className="underline" href={downloadUrl}>Télécharger le fichier complet</a>.
          </p>
        )}
      </article>
    </div>
  );
}

/**
 * Repli quand aucun lecteur fidèle n'existe (DOCX, PPTX, original non conservé) :
 * le TEXTE EXTRAIT est affiché, clairement présenté comme tel. L'original reste la référence.
 */
export function ExtractedTextViewer({ docId, reason, downloadUrl }: { docId: string; reason: string; downloadUrl: string | null }) {
  const [pages, setPages] = useState<{ page: number | null; text: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ pages: { page: number | null; text: string }[] }>(`/api/files/${docId}/text`)
      .then((r) => !cancelled && setPages(r.pages))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Texte indisponible."));
    return () => {
      cancelled = true;
    };
  }, [docId]);

  return (
    <div className="h-full overflow-auto bg-muted/40">
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div role="note" className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-2">
            <p>
              <strong>Texte extrait, pas le document original.</strong> {reason} La mise en page, les images et les tableaux ne sont pas reproduits.
            </p>
            {downloadUrl && (
              <Button asChild size="sm" variant="outline" className="gap-2 bg-background">
                <a href={downloadUrl}>
                  <Download className="h-4 w-4" aria-hidden /> Télécharger l&apos;original
                </a>
              </Button>
            )}
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!pages && !error && <Loading />}
        {pages?.length === 0 && <p className="text-sm text-muted-foreground">Aucun texte n&apos;a pu être extrait de ce document.</p>}
        {pages?.map((p, i) => (
          <section key={i} className="rounded-lg bg-background p-5 shadow-sm" aria-label={p.page ? `Page ${p.page}` : "Contenu"}>
            {p.page && <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Page / diapositive {p.page}</h2>}
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{p.text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
