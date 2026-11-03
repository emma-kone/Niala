"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  Info,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoveDialog, NameDialog } from "./dialogs";
import { uploadFiles, type UploadItem } from "./upload";
import { formatDate, formatSize, STATUS_LABEL, type DocumentDetails, type DocumentDto, type ExplorerResponse, type FolderDto } from "./types";
import { Properties } from "./properties";

type Sort = "name" | "date" | "size" | "type";
type Entry = { kind: "folder"; item: FolderDto } | { kind: "doc"; item: DocumentDto };
const ACCEPT = ".pdf,.docx,.pptx,.txt,.md";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);

export default function SubjectFilesView({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const folderId = params.get("dossier");

  const [data, setData] = useState<ExplorerResponse | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [inContent, setInContent] = useState(false);
  const [kind, setKind] = useState<string>("all");
  const [sort, setSort] = useState<Sort>("date");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newFolder, setNewFolder] = useState(false);
  const [renaming, setRenaming] = useState<Entry | null>(null);
  const [moving, setMoving] = useState<Entry[] | null>(null);
  const [deleting, setDeleting] = useState<Entry[] | null>(null);
  const [details, setDetails] = useState<{ id: string; data?: DocumentDetails; error?: string } | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);

  // Recherche différée
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const sp = new URLSearchParams();
    if (folderId) sp.set("folderId", folderId);
    if (query) sp.set("q", query);
    if (query && inContent) sp.set("content", "1");
    if (kind !== "all") sp.set("kind", kind);
    sp.set("sort", sort);
    sp.set("dir", dir);
    try {
      const res = await api.get<ExplorerResponse>(`/api/subjects/${subjectId}/explorer?${sp}`);
      if (seq !== requestSeq.current) return; // réponse périmée
      setData(res);
      setError(null);
      setSelected(new Set());
    } catch (e) {
      if (seq !== requestSeq.current) return;
      setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [subjectId, folderId, query, inContent, kind, sort, dir]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rafraîchit tant que des fichiers sont en cours de traitement
  const busyDocs = data?.documents.some((d) => d.status === "PENDING" || d.status === "PROCESSING");
  useEffect(() => {
    if (!busyDocs || uploads.some((u) => u.phase === "sending" || u.phase === "processing")) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  }, [busyDocs, data, uploads, load]);

  const goTo = (id: string | null) => {
    setSearch("");
    router.push(id ? `${routes.subject(subjectId)}?dossier=${id}` : routes.subject(subjectId));
  };

  const entries: Entry[] = useMemo(
    () => (data ? [...data.folders.map((f) => ({ kind: "folder" as const, item: f })), ...data.documents.map((d) => ({ kind: "doc" as const, item: d }))] : []),
    [data]
  );
  const keyOf = (e: Entry) => `${e.kind === "folder" ? "f" : "d"}:${e.item.id}`;
  const selectedEntries = entries.filter((e) => selected.has(keyOf(e)));

  // ── Actions ──
  async function createFolder(name: string) {
    await api.post("/api/folders", { subjectId, parentId: folderId, name });
    setNewFolder(false);
    await load();
  }

  async function rename(name: string) {
    if (!renaming) return;
    if (renaming.kind === "folder") await api.patch(`/api/folders/${renaming.item.id}`, { name });
    else await api.patch(`/api/files/${renaming.item.id}`, { name });
    setRenaming(null);
    await load();
  }

  async function move(target: string | null) {
    if (!moving) return;
    await api.put("/api/folders", {
      subjectId,
      folderIds: moving.filter((e) => e.kind === "folder").map((e) => e.item.id),
      documentIds: moving.filter((e) => e.kind === "doc").map((e) => e.item.id),
      targetFolderId: target,
    });
    toast({ title: "Éléments déplacés" });
    setMoving(null);
    await load();
  }

  async function remove() {
    if (!deleting) return;
    const items = deleting;
    try {
      for (const e of items) {
        if (e.kind === "folder") await api.del(`/api/folders/${e.item.id}`);
        else await api.del(`/api/files/${e.item.id}`);
      }
      toast({ title: items.length > 1 ? "Éléments supprimés" : "Élément supprimé" });
    } catch (err) {
      toast({ title: "Suppression incomplète", description: errText(err, "Réessayez."), variant: "destructive" });
    } finally {
      setDeleting(null);
      await load();
    }
  }

  async function openDetails(id: string) {
    setDetails({ id });
    try {
      const res = await api.get<{ document: DocumentDetails }>(`/api/files/${id}`);
      setDetails({ id, data: res.document });
    } catch (e) {
      setDetails({ id, error: errText(e, "Propriétés indisponibles.") });
    }
  }

  async function startUpload(list: FileList | File[]) {
    const files = Array.from(list);
    if (files.length === 0) return;
    const stamp = Date.now();
    const items: UploadItem[] = files.map((f, i) => ({ key: `${stamp}-${i}`, name: f.name, phase: "waiting" }));
    setUploads((prev) => [...items, ...prev].slice(0, 30));
    const update = (key: string, patch: Partial<UploadItem>) => setUploads((prev) => prev.map((u) => (u.key === key ? { ...u, ...patch } : u)));
    await uploadFiles(files, { subjectId, folderId }, update, items.map((i) => i.key));
    await load();
  }

  const nothingYet = data && !data.searching && entries.length === 0;
  const filtersActive = !!query || kind !== "all";

  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">{error.status === 404 ? "Matière introuvable" : "Chargement impossible"}</h1>
        <p className="typo-subtitle mt-2">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" asChild>
            <Link href={routes.subjects}>Mes matières</Link>
          </Button>
          {error.status !== 404 && <Button onClick={() => void load()}>Réessayer</Button>}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void startUpload(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/5 text-primary">
          <p className="typo-h3">Déposez vos fichiers ici</p>
        </div>
      )}

      {/* ── En-tête ── */}
      <nav aria-label="Fil d'Ariane" className="mb-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link href={routes.subjects} className="hover:text-foreground">
          Mes matières
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <button onClick={() => goTo(null)} className={cn("hover:text-foreground", !folderId && "font-semibold text-foreground")}>
          {data?.subject.name ?? "…"}
        </button>
        {data?.path.map((p, i) => (
          <span key={p.id} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            <button onClick={() => goTo(p.id)} className={cn("hover:text-foreground", i === data.path.length - 1 && "font-semibold text-foreground")}>
              {p.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="typo-h1 flex items-center gap-3">
          {data && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: data.subject.color }} aria-hidden />}
          {data?.path.length ? data.path[data.path.length - 1].name : (data?.subject.name ?? <Skeleton className="h-8 w-48" />)}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setNewFolder(true)} disabled={!data}>
            <FolderPlus className="h-4 w-4" aria-hidden /> Nouveau dossier
          </Button>
          <Button className="gap-2" onClick={() => fileInput.current?.click()} disabled={!data}>
            <Upload className="h-4 w-4" aria-hidden /> Importer
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label="Choisir des fichiers à importer"
            onChange={(e) => {
              if (e.target.files) void startUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {/* ── Imports en cours ── */}
      {uploads.length > 0 && (
        <section aria-label="Imports" className="mb-5 rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Imports</h2>
            <Button variant="ghost" size="sm" onClick={() => setUploads((u) => u.filter((x) => x.phase === "sending" || x.phase === "processing" || x.phase === "waiting"))}>
              Effacer les terminés
            </Button>
          </div>
          <ul className="space-y-1.5 text-sm" aria-live="polite">
            {uploads.map((u) => (
              <li key={u.key} className="flex items-start gap-2">
                {u.phase === "done" ? (
                  <span className="mt-0.5 text-emerald-600" aria-label="Terminé">✓</span>
                ) : u.phase === "error" ? (
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-label="Erreur" />
                ) : (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className={cn("typo-meta", u.phase === "error" && "text-destructive")}>
                    {u.phase === "waiting" && "En attente…"}
                    {u.phase === "sending" && "Envoi du fichier…"}
                    {u.phase === "processing" && "Extraction du texte…"}
                    {u.phase === "done" && (u.message ?? "Importé")}
                    {u.phase === "error" && u.message}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Outils de recherche / tri ── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher dans cette matière…"
            aria-label="Rechercher des documents"
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={inContent} onCheckedChange={(v) => setInContent(v === true)} aria-label="Chercher aussi dans le contenu" />
          Dans le contenu
        </label>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Filtrer par type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="docx">Word</SelectItem>
            <SelectItem value="pptx">PowerPoint</SelectItem>
            <SelectItem value="txt">Texte</SelectItem>
            <SelectItem value="md">Markdown</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Trier par">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date">Date d&apos;ajout</SelectItem>
            <SelectItem value="name">Nom</SelectItem>
            <SelectItem value="size">Taille</SelectItem>
            <SelectItem value="type">Type</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} aria-label={dir === "asc" ? "Ordre croissant" : "Ordre décroissant"}>
          {dir === "asc" ? <ArrowUpAZ className="h-4 w-4" aria-hidden /> : <ArrowDownAZ className="h-4 w-4" aria-hidden />}
        </Button>
      </div>

      {data?.searching && (
        <p className="typo-meta mb-2" role="status">
          {data.documents.length + data.folders.length} résultat(s) pour « {query} » dans toute la matière.
        </p>
      )}

      {/* ── Sélection groupée ── */}
      {selectedEntries.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm" role="toolbar" aria-label="Actions sur la sélection">
          <span className="font-medium">{selectedEntries.length} sélectionné(s)</span>
          <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={() => setMoving(selectedEntries)}>
            <FolderInput className="h-4 w-4" aria-hidden /> Déplacer
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => setDeleting(selectedEntries)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Supprimer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Annuler
          </Button>
        </div>
      )}

      {/* ── Liste ── */}
      {error && data && (
        <div role="alert" className="mb-3 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      )}

      {!data ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      ) : nothingYet ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <Upload className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="typo-h3 mt-3">{folderId ? "Ce dossier est vide" : "Aucun fichier dans cette matière"}</h2>
          <p className="typo-subtitle mx-auto mt-1 max-w-md">
            Glissez vos supports de cours ici ou utilisez « Importer ». Formats acceptés : PDF, Word, PowerPoint, texte, Markdown. Le fichier original est toujours conservé.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="typo-subtitle">{filtersActive ? "Aucun résultat pour ces critères." : "Rien à afficher."}</p>
          {filtersActive && (
            <Button variant="outline" className="mt-3" onClick={() => { setSearch(""); setKind("all"); }}>
              Réinitialiser les filtres
            </Button>
          )}
        </div>
      ) : (
        <div className={cn("overflow-hidden rounded-xl border bg-card transition-opacity", loading && "opacity-60")}>
          <div role="table" aria-label="Fichiers et dossiers" className="w-full text-sm">
            <div role="row" className="hidden items-center gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground sm:flex">
              <Checkbox
                aria-label="Tout sélectionner"
                checked={selected.size > 0 && selected.size === entries.length}
                onCheckedChange={(v) => setSelected(v === true ? new Set(entries.map(keyOf)) : new Set())}
              />
              <span className="flex-1">Nom</span>
              <span className="w-16">Type</span>
              <span className="w-20 text-right">Taille</span>
              <span className="w-28">Ajouté le</span>
              <span className="w-24">État</span>
              <span className="w-8" />
            </div>
            {entries.map((e) => {
              const key = keyOf(e);
              const isFolder = e.kind === "folder";
              const d = e.kind === "doc" ? e.item : null;
              const f = e.kind === "folder" ? e.item : null;
              const status = d ? STATUS_LABEL[d.status] : null;
              return (
                <div key={key} role="row" className={cn("flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40", selected.has(key) && "bg-primary/5")}>
                  <Checkbox
                    aria-label={`Sélectionner ${e.item.name}`}
                    checked={selected.has(key)}
                    onCheckedChange={(v) =>
                      setSelected((prev) => {
                        const n = new Set(prev);
                        if (v === true) n.add(key);
                        else n.delete(key);
                        return n;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    {isFolder ? (
                      <button onClick={() => goTo(f!.id)} className="flex w-full min-w-0 items-center gap-2.5 text-left">
                        <Folder className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
                        <span className="truncate font-medium">{f!.name}</span>
                        <span className="typo-meta hidden shrink-0 sm:inline">
                          {f!.folderCount + f!.documentCount === 0 ? "vide" : `${f!.documentCount} fichier(s)${f!.folderCount ? `, ${f!.folderCount} dossier(s)` : ""}`}
                        </span>
                      </button>
                    ) : (
                      <Link href={`${routes.subject(subjectId)}/documents/${d!.id}`} className="flex w-full min-w-0 items-center gap-2.5 text-left">
                        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{d!.name}</span>
                          {data.searching && d!.folderPath && <span className="typo-meta block truncate">{d!.folderPath}</span>}
                        </span>
                      </Link>
                    )}
                    {isFolder && data.searching && f!.path && <span className="typo-meta block pl-7 truncate">{f!.path}</span>}
                  </div>
                  <span className="hidden w-16 text-xs uppercase text-muted-foreground sm:block">{d?.kind ?? ""}</span>
                  <span className="hidden w-20 text-right text-xs text-muted-foreground sm:block">{d ? formatSize(d.size) : ""}</span>
                  <span className="hidden w-28 text-xs text-muted-foreground sm:block">{d ? formatDate(d.createdAt) : formatDate(f!.updatedAt)}</span>
                  <span className="hidden w-24 sm:block">
                    {status && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-normal",
                          status.tone === "ok" && "border-emerald-300 text-emerald-700 dark:text-emerald-400",
                          status.tone === "warn" && "border-amber-300 text-amber-700 dark:text-amber-400",
                          status.tone === "bad" && "border-destructive/40 text-destructive"
                        )}
                      >
                        {status.label}
                      </Badge>
                    )}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions pour ${e.item.name}`}>
                        <MoreVertical className="h-4 w-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {d && (
                        <>
                          <DropdownMenuItem asChild>
                            <Link href={`${routes.subject(subjectId)}/documents/${d.id}`}>
                              <FileText className="mr-2 h-4 w-4" aria-hidden /> Lire
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={d.originalMissing} asChild={!d.originalMissing}>
                            {d.originalMissing ? (
                              <span><ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Original indisponible</span>
                            ) : (
                              <a href={`/api/files/${d.id}/content`} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Ouvrir l&apos;original
                              </a>
                            )}
                          </DropdownMenuItem>
                          {!d.originalMissing && (
                            <DropdownMenuItem asChild>
                              <a href={`/api/files/${d.id}/content?download=1`}>
                                <Download className="mr-2 h-4 w-4" aria-hidden /> Télécharger
                              </a>
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onSelect={() => void openDetails(d.id)}>
                            <Info className="mr-2 h-4 w-4" aria-hidden /> Propriétés
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem onSelect={() => setRenaming(e)}>
                        <Pencil className="mr-2 h-4 w-4" aria-hidden /> Renommer
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setMoving([e])}>
                        <FolderInput className="mr-2 h-4 w-4" aria-hidden /> Déplacer…
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting([e])}>
                        <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Dialogues ── */}
      <NameDialog open={newFolder} title="Nouveau dossier" description="Les dossiers sont libres : créez l'organisation qui vous convient." initial="" submitLabel="Créer" onClose={() => setNewFolder(false)} onSubmit={createFolder} />
      <NameDialog open={!!renaming} title="Renommer" initial={renaming?.item.name ?? ""} submitLabel="Renommer" onClose={() => setRenaming(null)} onSubmit={rename} />
      <MoveDialog
        open={!!moving}
        tree={data?.tree ?? []}
        movingFolderIds={moving?.filter((e) => e.kind === "folder").map((e) => e.item.id) ?? []}
        count={moving?.length ?? 0}
        currentFolderId={folderId}
        onClose={() => setMoving(null)}
        onMove={move}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer {deleting && deleting.length > 1 ? `${deleting.length} éléments` : `« ${deleting?.[0]?.item.name} »`} ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.some((e) => e.kind === "folder")
                ? "Les dossiers sélectionnés, leurs sous-dossiers et tous les fichiers qu'ils contiennent seront supprimés avec leurs originaux. "
                : "Le fichier original et son texte indexé seront supprimés. "}
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void remove()}>
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{details?.data?.name ?? "Propriétés"}</SheetTitle>
            <SheetDescription>{details?.data?.originalName}</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {details && !details.data && !details.error && <Skeleton className="h-40 w-full" />}
            {details?.error && <p role="alert" className="text-sm text-destructive">{details.error}</p>}
            {details?.data && <Properties doc={details.data} />}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
