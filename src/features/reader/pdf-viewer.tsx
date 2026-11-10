"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Maximize,
  Minimize,
  PanelLeft,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Lecteur PDF fidèle (pdf.js) : rendu canvas + couche de texte sélectionnable,
// défilement continu, zoom, recherche, miniatures, plein écran. Lecture seule.
// ─────────────────────────────────────────────────────────────────────────────

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return m;
  });
  return pdfjsPromise;
}

const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface PdfAnnotation {
  id: string;
  page: number;
  rects: { x: number; y: number; w: number; h: number }[];
}

export interface PdfSelection {
  page: number;
  quote: string;
  rects: { x: number; y: number; w: number; h: number }[];
}

interface Props {
  src: string;
  downloadUrl: string;
  fileName: string;
  initialPage?: number;
  onPageChange?: (page: number) => void;
  onLoaded?: (numPages: number) => void;
  /** Annotations à surligner (coordonnées en unités PDF, échelle 1). */
  annotations?: PdfAnnotation[];
  activeAnnotationId?: string | null;
  onAnnotationClick?: (id: string) => void;
  /** Appelé quand l'étudiant choisit « Annoter » sur un passage sélectionné. */
  onAnnotate?: (selection: PdfSelection) => void;
  /** Demande de navigation externe (le nonce force le saut même vers la même page). */
  navigate?: { page: number; nonce: number } | null;
}

export default function PdfViewer({ src, downloadUrl, fileName, initialPage = 1, onPageChange, onLoaded, annotations = [], activeAnnotationId = null, onAnnotationClick, onAnnotate, navigate = null }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map());

  const [pdfjs, setPdfjs] = useState<PdfJs | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [page, setPage] = useState(initialPage);
  const [pageInput, setPageInput] = useState(String(initialPage));
  const [thumbs, setThumbs] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // recherche
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [hits, setHits] = useState<{ page: number; count: number }[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [hitIdx, setHitIdx] = useState(0);
  const textCache = useRef<Map<number, string>>(new Map());

  // ── Chargement du document ──
  useEffect(() => {
    let cancelled = false;
    // pdf.js 6 : le document se ferme par sa tâche de chargement (worker et requêtes compris).
    let loading: { destroy(): Promise<void> } | null = null;
    setError(null);
    setDoc(null);
    (async () => {
      try {
        const lib = await loadPdfJs();
        if (cancelled) return;
        setPdfjs(lib);
        const task = lib.getDocument({ url: src, withCredentials: true });
        loading = task;
        const pdf = await task.promise;
        if (cancelled) return void task.destroy();
        const first = await pdf.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setBaseSize({ w: vp.width, h: vp.height });
        setDoc(pdf);
        onLoaded?.(pdf.numPages);
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        setError(
          name === "PasswordException"
            ? "Ce PDF est protégé par un mot de passe : il ne peut pas être affiché."
            : name === "InvalidPDFException"
              ? "Ce fichier n'est pas un PDF valide."
              : "Impossible d'afficher ce PDF. Vous pouvez le télécharger."
        );
      }
    })();
    return () => {
      cancelled = true;
      void loading?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // ── Largeur disponible (adaptation au panneau, au plein écran, au mobile) ──
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [doc]);

  const scale = useMemo(() => {
    if (!baseSize) return 1;
    if (zoom === "fit") return Math.min(MAX_SCALE, Math.max(MIN_SCALE, (width - 32) / baseSize.w));
    return zoom;
  }, [zoom, width, baseSize]);

  const numPages = doc?.numPages ?? 0;

  // ── Navigation ──
  const goToPage = useCallback(
    (n: number, behavior: ScrollBehavior = "auto") => {
      if (!doc) return;
      const target = Math.min(Math.max(1, Math.round(n)), doc.numPages);
      const el = pageEls.current.get(target);
      if (el && scrollRef.current) scrollRef.current.scrollTo({ top: el.offsetTop - 8, behavior });
      setPage(target);
      setPageInput(String(target));
    },
    [doc]
  );

  // Reprise : se place sur la dernière page lue. Les hauteurs de page se précisent au rendu :
  // on recale deux fois (minuteurs indépendants des changements de dépendances).
  const resumed = useRef(false);
  const retryTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    if (!doc || !baseSize || width === 0 || resumed.current) return;
    resumed.current = true;
    const start = Math.min(Math.max(1, initialPage), doc.numPages);
    goToPage(start);
    retryTimers.current = [300, 900].map((ms) => setTimeout(() => goToPage(start), ms));
  }, [doc, baseSize, width, initialPage, goToPage]);
  useEffect(() => () => retryTimers.current.forEach(clearTimeout), []);

  // Page courante = première page dont le bas dépasse 30 % de la hauteur visible
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !doc) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const line = el.scrollTop + el.clientHeight * 0.3;
        let current = 1;
        for (let i = 1; i <= doc.numPages; i++) {
          const p = pageEls.current.get(i);
          if (!p) continue;
          if (p.offsetTop + p.offsetHeight > line) {
            current = i;
            break;
          }
          current = i;
        }
        setPage((prev) => {
          if (prev !== current) setPageInput(String(current));
          return current;
        });
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [doc]);

  // Signale chaque changement de page (défilement, boutons, miniatures, recherche) pour mémoriser la lecture
  useEffect(() => {
    if (doc && resumed.current) onPageChange?.(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, doc]);

  // Conserver la page lors d'un changement de zoom
  const zoomTo = (next: number | "fit") => {
    const current = page;
    setZoom(next);
    setTimeout(() => goToPage(current), 60);
  };
  const step = (f: number) => zoomTo(Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(scale * f).toFixed(3))));

  // ── Navigation demandée depuis l'extérieur (panneau de notes) ──
  useEffect(() => {
    if (navigate && doc) goToPage(navigate.page, "smooth");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate?.nonce, doc]);

  // ── Sélection de texte → bouton « Annoter » ──
  const [sel, setSel] = useState<(PdfSelection & { x: number; y: number }) | null>(null);
  useEffect(() => {
    const host = scrollRef.current;
    if (!host || !onAnnotate) return;
    const read = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return setSel(null);
      const range = selection.getRangeAt(0);
      const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
      const holder = startEl?.closest<HTMLElement>("[data-page]");
      if (!holder || !host.contains(holder)) return setSel(null);
      const pageNo = Number(holder.dataset.page);
      const quote = selection.toString().replace(/\s+/g, " ").trim().slice(0, 1000);
      if (!quote) return setSel(null);
      const box = holder.getBoundingClientRect();
      // Rectangles de la sélection, rognés à la page (un fragment de texte peut déborder de la page)
      const rects = Array.from(range.getClientRects())
        .map((r) => ({ l: Math.max(r.left, box.left), t: Math.max(r.top, box.top), r: Math.min(r.right, box.right), b: Math.min(r.bottom, box.bottom) }))
        .filter((r) => r.r - r.l > 1 && r.b - r.t > 1)
        .slice(0, 60)
        .map((r) => ({ x: (r.l - box.left) / scale, y: (r.t - box.top) / scale, w: (r.r - r.l) / scale, h: (r.b - r.t) / scale }));
      if (rects.length === 0) return setSel(null);
      const last = range.getBoundingClientRect();
      setSel({ page: pageNo, quote, rects, x: Math.min(last.right, window.innerWidth - 120), y: last.bottom + 6 });
    };
    const onUp = () => setTimeout(read, 0);
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element)?.closest?.("[data-annotate-button]")) setSel(null);
    };
    host.addEventListener("mouseup", onUp);
    host.addEventListener("keyup", onUp);
    host.addEventListener("mousedown", onDown);
    host.addEventListener("scroll", () => setSel(null), { passive: true });
    return () => {
      host.removeEventListener("mouseup", onUp);
      host.removeEventListener("keyup", onUp);
      host.removeEventListener("mousedown", onDown);
    };
  }, [doc, scale, onAnnotate]);

  // ── Plein écran ──
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  };

  // ── Recherche ──
  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = fold(query.trim());
    if (!doc || !q) {
      setHits(null);
      setActiveQuery("");
      return;
    }
    setSearching(true);
    setActiveQuery(query.trim());
    const found: { page: number; count: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      let text = textCache.current.get(i);
      if (text === undefined) {
        const p = await doc.getPage(i);
        const content = await p.getTextContent();
        text = fold(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
        textCache.current.set(i, text);
      }
      let count = 0;
      for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + q.length)) count++;
      if (count) found.push({ page: i, count });
    }
    setHits(found);
    setHitIdx(0);
    setSearching(false);
    if (found.length) goToPage(found.find((h) => h.page >= page)?.page ?? found[0].page);
  };
  const moveHit = (dir: 1 | -1) => {
    if (!hits?.length) return;
    const next = (hitIdx + dir + hits.length) % hits.length;
    setHitIdx(next);
    goToPage(hits[next].page);
  };
  const clearSearch = () => {
    setQuery("");
    setActiveQuery("");
    setHits(null);
    setSearchOpen(false);
  };
  const totalHits = hits?.reduce((a, h) => a + h.count, 0) ?? 0;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p role="alert" className="max-w-md text-sm font-medium">{error}</p>
        <Button asChild variant="outline" className="gap-2">
          <a href={downloadUrl}>
            <Download className="h-4 w-4" aria-hidden /> Télécharger le fichier
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-muted/40">
      {/* ── Barre d'outils ── */}
      <div role="toolbar" aria-label="Outils du lecteur PDF" className="flex flex-wrap items-center gap-1 border-b bg-background px-2 py-1.5">
        <Button variant={thumbs ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => setThumbs((v) => !v)} aria-pressed={thumbs} aria-label="Afficher les miniatures" disabled={!doc}>
          <PanelLeft className="h-4 w-4" aria-hidden />
        </Button>
        <div className="mx-1 flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(page - 1)} disabled={!doc || page <= 1} aria-label="Page précédente">
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              goToPage(Number(pageInput) || page);
            }}
            className="flex items-center gap-1 text-sm"
          >
            <Input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              aria-label="Numéro de page"
              className="h-8 w-12 px-1 text-center"
              disabled={!doc}
            />
            <span className="text-muted-foreground" aria-label={`sur ${numPages} pages`}>/ {numPages || "…"}</span>
          </form>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => goToPage(page + 1)} disabled={!doc || page >= numPages} aria-label="Page suivante">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="mx-1 flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(1 / 1.2)} disabled={!doc || scale <= MIN_SCALE} aria-label="Zoom arrière">
            <ZoomOut className="h-4 w-4" aria-hidden />
          </Button>
          <button
            type="button"
            onClick={() => zoomTo("fit")}
            className="min-w-14 rounded-md px-2 py-1 text-center text-xs font-medium hover:bg-muted"
            aria-label="Ajuster à la largeur"
            title="Ajuster à la largeur"
            disabled={!doc}
          >
            {Math.round(scale * 100)} %
          </button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => step(1.2)} disabled={!doc || scale >= MAX_SCALE} aria-label="Zoom avant">
            <ZoomIn className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant={searchOpen ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => setSearchOpen((v) => !v)} aria-pressed={searchOpen} aria-label="Rechercher dans le document" disabled={!doc}>
            <Search className="h-4 w-4" aria-hidden />
          </Button>
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <a href={downloadUrl} aria-label={`Télécharger ${fileName}`} title="Télécharger">
              <Download className="h-4 w-4" aria-hidden />
            </a>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen} aria-label={fullscreen ? "Quitter le plein écran" : "Plein écran"} disabled={!doc}>
            {fullscreen ? <Minimize className="h-4 w-4" aria-hidden /> : <Maximize className="h-4 w-4" aria-hidden />}
          </Button>
        </div>
      </div>

      {searchOpen && (
        <form onSubmit={runSearch} className="flex items-center gap-2 border-b bg-background px-3 py-1.5" role="search">
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher dans le PDF…" aria-label="Terme à rechercher" className="h-8 max-w-xs" />
          <Button type="submit" size="sm" variant="secondary" disabled={searching || !query.trim()}>
            {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Chercher"}
          </Button>
          {hits && (
            <>
              <span className="text-xs text-muted-foreground" role="status">
                {totalHits === 0 ? "Aucun résultat" : `${totalHits} résultat${totalHits > 1 ? "s" : ""} · page${hits.length > 1 ? "s" : ""} ${hits.map((h) => h.page).slice(0, 6).join(", ")}${hits.length > 6 ? "…" : ""}`}
              </span>
              {hits.length > 1 && (
                <>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveHit(-1)} aria-label="Résultat précédent">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveHit(1)} aria-label="Résultat suivant">
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </Button>
                </>
              )}
            </>
          )}
          <Button type="button" variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={clearSearch} aria-label="Fermer la recherche">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      )}

      {sel && onAnnotate && (
        <button
          type="button"
          data-annotate-button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAnnotate({ page: sel.page, quote: sel.quote, rects: sel.rects });
            window.getSelection()?.removeAllRanges();
            setSel(null);
          }}
          style={{ position: "fixed", left: sel.x, top: sel.y, zIndex: 50 }}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-lg"
        >
          Annoter ce passage
        </button>
      )}

      {/* ── Zone de lecture ── */}
      <div className="flex min-h-0 flex-1">
        {thumbs && doc && pdfjs && (
          <aside aria-label="Miniatures" className="hidden w-36 shrink-0 overflow-y-auto border-r bg-background p-2 sm:block">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <Thumb key={i} doc={doc} pageNumber={i + 1} current={page === i + 1} onSelect={() => goToPage(i + 1)} />
            ))}
          </aside>
        )}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto" tabIndex={0} aria-label="Document PDF">
          {!doc && (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement du document…
            </div>
          )}
          {doc && baseSize && (
            <div className="mx-auto flex w-max min-w-full flex-col items-center gap-3 pt-3 pb-[calc(0.75rem+var(--toolbar-clearance,0px))]">
              {Array.from({ length: doc.numPages }, (_, i) => (
                <PageView
                  key={i}
                  doc={doc}
                  pageNumber={i + 1}
                  scale={scale}
                  base={baseSize}
                  query={activeQuery}
                  marks={annotations.filter((a) => a.page === i + 1)}
                  activeId={activeAnnotationId}
                  onMarkClick={onAnnotationClick}
                  register={(el) => (el ? pageEls.current.set(i + 1, el) : pageEls.current.delete(i + 1))}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Une page : canvas + couche de texte, rendus à l'approche de la zone visible ──
function PageView({
  doc,
  pageNumber,
  scale,
  base,
  query,
  marks,
  activeId,
  onMarkClick,
  register,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  base: { w: number; h: number };
  query: string;
  marks: PdfAnnotation[];
  activeId: string | null;
  onMarkClick?: (id: string) => void;
  register: (el: HTMLDivElement | null) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [rendered, setRendered] = useState(0);
  const [canvasReady, setCanvasReady] = useState(false);

  const width = Math.floor((dims?.w ?? base.w) * scale);
  const height = Math.floor((dims?.h ?? base.h) * scale);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    register(el);
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: null, rootMargin: "900px 0px" });
    io.observe(el);
    return () => {
      io.disconnect();
      register(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = canvas.current;
    const t = textLayer.current;
    if (!near) {
      // libère la mémoire des pages éloignées
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      if (t) t.replaceChildren();
      setRendered(0);
      setCanvasReady(false);
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;
    let page: PDFPageProxy | null = null;
    (async () => {
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled || !c || !t) return;
        const raw = page.getViewport({ scale: 1 });
        setDims((d) => (d && d.w === raw.width && d.h === raw.height ? d : { w: raw.width, h: raw.height }));
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        c.width = Math.floor(viewport.width * ratio);
        c.height = Math.floor(viewport.height * ratio);
        c.style.width = `${Math.floor(viewport.width)}px`;
        c.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        task = page.render({ canvas: c, canvasContext: ctx, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
        await task.promise;
        if (cancelled) return;
        setCanvasReady(true);

        // Couche de texte (sélection, copie, surlignage de la recherche)
        const lib = await loadPdfJs();
        t.replaceChildren();
        t.style.setProperty("--scale-factor", String(scale));
        const layer = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: t, viewport });
        await layer.render();
        if (cancelled) return;
        setRendered((n) => n + 1);
      } catch (e) {
        if ((e as { name?: string })?.name !== "RenderingCancelledException") console.warn("[pdf] page", pageNumber, e);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
      page?.cleanup();
    };
  }, [near, doc, pageNumber, scale]);

  // Surlignage : tout fragment de texte contenant le terme
  useEffect(() => {
    const t = textLayer.current;
    if (!t) return;
    const q = query ? fold(query) : "";
    t.querySelectorAll("span").forEach((s) => {
      s.classList.toggle("sf-hit", !!q && fold(s.textContent ?? "").includes(q));
    });
  }, [query, rendered]);

  return (
    <div
      ref={holder}
      data-page={pageNumber}
      className="textLayerHost relative shrink-0 bg-white shadow-md"
      style={{ width, height }}
      role="img"
      aria-label={`Page ${pageNumber}`}
    >
      <canvas ref={canvas} className="block" />
      <div ref={textLayer} className="textLayer" style={{ width, height }} />
      {marks.map((m) => (
        <div key={m.id} aria-hidden className="pointer-events-none absolute inset-0">
          {m.rects.map((r, i) => (
            <div
              key={i}
              className={cn("absolute rounded-sm mix-blend-multiply", m.id === activeId ? "bg-amber-400/60 ring-1 ring-amber-500" : "bg-yellow-300/45")}
              style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
            />
          ))}
        </div>
      ))}
      {marks.map((m) =>
        m.rects[0] ? (
          <button
            key={"btn" + m.id}
            type="button"
            onClick={() => onMarkClick?.(m.id)}
            aria-label="Ouvrir l'annotation"
            className={cn("absolute z-10 h-4 w-4 rounded-full border-2 border-white shadow", m.id === activeId ? "bg-amber-500" : "bg-yellow-500")}
            style={{ left: Math.max(2, m.rects[0].x * scale - 20), top: m.rects[0].y * scale + 2 }}
          />
        ) : null
      )}
      {near && !canvasReady && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400" aria-hidden>
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}
    </div>
  );
}

function Thumb({ doc, pageNumber, current, onSelect }: { doc: PDFDocumentProxy; pageNumber: number; current: boolean; onSelect: () => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || done.current) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const c = canvas.current;
      if (cancelled || !c) return;
      const raw = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 112 / raw.width });
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvas: c, canvasContext: ctx, viewport });
      await task.promise;
      done.current = true;
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, doc, pageNumber]);

  return (
    <button
      ref={box}
      type="button"
      onClick={onSelect}
      aria-label={`Aller à la page ${pageNumber}`}
      aria-current={current ? "page" : undefined}
      className={cn("mb-2 block w-full rounded-md p-1 text-center", current ? "bg-primary/10 ring-2 ring-primary" : "hover:bg-muted")}
    >
      <canvas ref={canvas} className="mx-auto block max-w-full bg-white shadow-sm" style={{ minHeight: 140 }} />
      <span className="mt-1 block text-[11px] text-muted-foreground">{pageNumber}</span>
    </button>
  );
}
