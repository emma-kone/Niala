"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, FilePlus2, NotebookPen, Plus, Search, Sparkles } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SubjectTabs } from "@/features/subject-files/tabs";
import { NoteEditor } from "@/features/notes/note-editor";
import { NOTE_KIND_LABEL, type NoteKind, type NoteListItem } from "@/features/notes/types";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);

export default function SubjectNotesView({ subjectId }: { subjectId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("note");

  const [subject, setSubject] = useState<{ name: string; color: string } | null>(null);
  const [notes, setNotes] = useState<NoteListItem[] | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | NoteKind>("all");
  const [doc, setDoc] = useState("all");
  const [docs, setDocs] = useState<{ id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    api.get<{ subject: { name: string; color: string } }>(`/api/subjects/${subjectId}`).then((r) => setSubject(r.subject)).catch((e) => setError({ message: errText(e, "Matière introuvable."), status: (e as { status?: number }).status }));
    api.get<{ documents: { id: string; name: string }[] }>(`/api/subjects/${subjectId}/documents`).then((r) => setDocs(r.documents)).catch(() => undefined);
  }, [subjectId]);

  const load = useCallback(async () => {
    const n = ++seq.current;
    const sp = new URLSearchParams();
    if (kind !== "all") sp.set("kind", kind);
    if (doc !== "all") sp.set("documentId", doc);
    if (query) sp.set("q", query);
    try {
      const res = await api.get<{ notes: NoteListItem[] }>(`/api/subjects/${subjectId}/notes?${sp}`);
      if (n !== seq.current) return;
      setNotes(res.notes);
      setError(null);
    } catch (e) {
      if (n === seq.current) setError({ message: errText(e, "Chargement impossible."), status: (e as { status?: number }).status });
    }
  }, [subjectId, kind, doc, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = (id: string | null) => router.replace(id ? `${routes.subject(subjectId)}/notes?note=${id}` : `${routes.subject(subjectId)}/notes`);

  async function create(k: "PERSONAL" | "SUMMARY") {
    setCreating(true);
    try {
      const r = await api.post<{ note: NoteListItem }>(`/api/subjects/${subjectId}/notes`, {
        kind: k,
        title: k === "SUMMARY" ? "Fiche de synthèse" : "",
      });
      await load();
      select(r.note.id);
    } catch (e) {
      setError({ message: errText(e, "Création impossible.") });
    } finally {
      setCreating(false);
    }
  }

  if (error?.status === 404 && !notes) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">Matière introuvable</h1>
        <Button asChild variant="outline" className="mt-6"><Link href={routes.subjects}>Mes matières</Link></Button>
      </div>
    );
  }

  const filtersActive = kind !== "all" || doc !== "all" || !!query;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <nav aria-label="Fil d'Ariane" className="mb-1 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={routes.subjects} className="hover:text-foreground">Mes matières</Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        <Link href={routes.subject(subjectId)} className="hover:text-foreground">{subject?.name ?? "…"}</Link>
      </nav>
      <h1 className="typo-h1 mb-5 flex items-center gap-3">
        {subject && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: subject.color }} aria-hidden />}
        {subject?.name ?? <Skeleton className="h-8 w-48" />}
      </h1>
      <SubjectTabs subjectId={subjectId} active="notes" />

      <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
        {/* ── Liste ── */}
        <section aria-label="Liste des notes" className={cn("min-w-0", selected && "hidden md:block")}>
          <div className="mb-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher dans les notes" className="pl-9" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="gap-1.5" disabled={creating}><Plus className="h-4 w-4" aria-hidden /> Nouvelle</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void create("PERSONAL")}><NotebookPen className="mr-2 h-4 w-4" aria-hidden /> Note personnelle</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void create("SUMMARY")}><Sparkles className="mr-2 h-4 w-4" aria-hidden /> Fiche de synthèse</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="mb-3 flex gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as "all" | NoteKind)}>
              <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Filtrer par nature"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes les natures</SelectItem>
                {(Object.keys(NOTE_KIND_LABEL) as NoteKind[]).map((k) => <SelectItem key={k} value={k}>{NOTE_KIND_LABEL[k]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={doc} onValueChange={setDoc}>
              <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Filtrer par document"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les documents</SelectItem>
                {docs.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {error && notes && (
            <div role="alert" className="mb-3 flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.message}
              <Button size="sm" variant="outline" onClick={() => void load()}>Réessayer</Button>
            </div>
          )}
          {!notes && !error && <div className="space-y-2" aria-busy>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>}
          {error && !notes && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error.message} <Button size="sm" variant="outline" className="ml-2" onClick={() => void load()}>Réessayer</Button>
            </div>
          )}
          {notes?.length === 0 && (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center">
              <FilePlus2 className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
              <p className="typo-h3 mt-2">{filtersActive ? "Aucune note ne correspond" : "Aucune note"}</p>
              <p className="typo-subtitle mt-1">
                {filtersActive ? "Modifiez la recherche ou les filtres." : "Écrivez des résumés, des définitions, des fiches de révision. Depuis le lecteur, vous pouvez aussi annoter un passage du cours : tout arrive ici."}
              </p>
            </div>
          )}
          <ul className="space-y-2">
            {notes?.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => select(n.id)}
                  aria-current={selected === n.id ? "true" : undefined}
                  className={cn("w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50", selected === n.id && "border-primary bg-primary/5")}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold">{n.title || (n.kind === "ANNOTATION" ? "Annotation" : "Sans titre")}</span>
                    <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{NOTE_KIND_LABEL[n.kind]}</span>
                  </div>
                  {n.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{n.snippet}</p>}
                  {n.links.length > 0 && (
                    <p className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                      <FileText className="h-3 w-3 shrink-0" aria-hidden />
                      {n.links.map((l) => `${l.documentName}${l.page ? ` p. ${l.page}` : ""}`).slice(0, 2).join(" · ")}
                      {n.links.length > 2 ? ` +${n.links.length - 2}` : ""}
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Éditeur ── */}
        <section aria-label="Éditeur de note" className={cn("min-w-0 overflow-hidden rounded-xl border bg-card", !selected && "hidden md:flex md:min-h-96 md:items-center md:justify-center")}>
          {selected ? (
            <div className="flex h-[calc(100dvh-16rem)] min-h-[28rem] flex-col">
              <Button variant="ghost" size="sm" className="m-2 w-fit gap-1 md:hidden" onClick={() => select(null)}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Toutes les notes
              </Button>
              <div className="min-h-0 flex-1">
                <NoteEditor
                  noteId={selected}
                  subjectId={subjectId}
                  onSaved={() => void load()}
                  onChanged={() => void load()}
                  onDeleted={() => {
                    select(null);
                    void load();
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="typo-subtitle p-6 text-center">Sélectionnez une note ou créez-en une.</p>
          )}
        </section>
      </div>
    </div>
  );
}
