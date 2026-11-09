"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, Network, Plus, Sparkles, Upload } from "lucide-react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { uploadFiles, type UploadItem } from "@/features/subject-files/upload";
import type { MapListItem } from "./types";

const MIN_TEXT = 300;

/** Toutes les cartes de l'étudiant, et la génération depuis un fichier importé ou un texte collé (sans cours enregistré). */
export default function MapsHome() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["maps"], queryFn: () => api.get<{ maps: MapListItem[] }>("/api/maps").then((r) => r.maps) });
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"text" | "file" | "empty" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function open(promise: Promise<{ id: string }>) {
    setError(null);
    try {
      const r = await promise;
      void qc.invalidateQueries({ queryKey: ["maps"] });
      router.push(`/cartes/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "La carte n'a pas pu être créée.");
      setBusy(null);
    }
  }

  async function fromFile(file: File) {
    setBusy("file");
    setError(null);
    const item: UploadItem = { key: `${file.name}-${Date.now()}`, name: file.name, phase: "waiting" };
    let latest = item;
    await uploadFiles([file], { subjectId: null, folderId: null }, (_k, patch) => (latest = { ...latest, ...patch }), [item.key]);
    if (latest.phase !== "done" || !latest.documentId) {
      setError(latest.message ?? "Le fichier n'a pas pu être importé.");
      setBusy(null);
      return;
    }
    await open(api.post<{ id: string }>("/api/maps/from-content", { documentId: latest.documentId, title: title.trim() || undefined }));
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="typo-h1">Cartes mentales</h1>
          <p className="typo-subtitle mt-1">Générées par l&apos;IA depuis un cours, un fichier ou un texte, puis modifiables à votre guise. Vous pouvez aussi en générer depuis la page d&apos;un cours.</p>
        </div>
        <Button variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => { setBusy("empty"); void open(api.post<{ id: string }>("/api/maps", { title: title.trim() || "Nouvelle carte" })); }}><Plus className="h-4 w-4" aria-hidden /> Carte vide</Button>
      </header>

      <section aria-labelledby="mm-new" className="rounded-3xl border bg-card p-5">
        <h2 id="mm-new" className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4" aria-hidden /> Créer une carte avec l&apos;IA</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="mm-title">Titre <span className="font-normal text-muted-foreground">(facultatif)</span></Label><Input id="mm-title" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="mm-text">Texte du cours</Label>
              <Textarea id="mm-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Collez ici un cours, un résumé ou vos notes…" />
              <p className="typo-meta">{text.trim().length < MIN_TEXT ? `Encore ${MIN_TEXT - text.trim().length} caractères au moins.` : `${text.trim().length} caractères.`}</p>
            </div>
            <Button className="gap-2" disabled={busy !== null || text.trim().length < MIN_TEXT} onClick={() => { setBusy("text"); void open(api.post<{ id: string }>("/api/maps/from-content", { text, title: title.trim() || undefined })); }}>
              {busy === "text" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Network className="h-4 w-4" aria-hidden />} {busy === "text" ? "Génération en cours…" : "Générer depuis ce texte"}
            </Button>
          </div>
          <div className="flex flex-col justify-center gap-2 rounded-2xl border border-dashed p-4 text-center text-sm">
            <input ref={input} type="file" accept=".pdf,.docx,.pptx,.txt,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void fromFile(f); }} />
            <p className="text-muted-foreground">Ou importez un cours : PDF, DOCX, PPTX, TXT, MD.</p>
            <Button variant="outline" className="gap-2" disabled={busy !== null} onClick={() => input.current?.click()}>
              {busy === "file" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Upload className="h-4 w-4" aria-hidden />} {busy === "file" ? "Import et lecture…" : "Importer un fichier"}
            </Button>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <h2 className="typo-h3 mb-2 mt-6">Mes cartes</h2>
      {isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy>{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>}
      {data?.length === 0 && <p className="typo-subtitle">Aucune carte pour l&apos;instant.</p>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((m) => (
          <li key={m.id} className="rounded-xl border bg-card transition-shadow hover:shadow-md">
            <Link href={m.subject ? `/matieres/${m.subject.id}/cartes/${m.id}` : `/cartes/${m.id}`} className="block rounded-xl p-4">
              <h3 className="typo-h3 truncate">{m.title}</h3>
              <p className="typo-meta mt-1">{m.nodes} nœud(s) · {m.edges} relation(s) · {new Date(m.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</p>
              {(m.document || m.subject) && <p className="typo-meta mt-0.5 flex items-center gap-1 truncate"><FileText className="h-3 w-3 shrink-0" aria-hidden /> {m.document?.name ?? m.subject?.name}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
