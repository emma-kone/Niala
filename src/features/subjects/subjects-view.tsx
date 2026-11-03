"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, FolderOpen, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface SubjectDto {
  id: string;
  name: string;
  color: string;
  updatedAt: string;
  _count: { documents: number };
}

const PALETTE = ["#8b5cf6", "#059669", "#d97706", "#2563eb", "#db2777", "#0d9488", "#dc2626", "#475569"];

function errorText(e: unknown, fallback: string) {
  return e instanceof Error ? e.message : fallback;
}

export default function SubjectsView() {
  const { toast } = useToast();
  const [subjects, setSubjects] = useState<SubjectDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ subject: SubjectDto | null } | null>(null);
  const [deleting, setDeleting] = useState<{ subject: SubjectDto; documents: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get<{ subjects: SubjectDto[] }>("/api/subjects");
      setSubjects(res.subjects);
    } catch (e) {
      setError(errorText(e, "Impossible de charger vos matières."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function askDelete(subject: SubjectDto) {
    try {
      const res = await api.get<{ consequences: { documents: number } }>(`/api/subjects/${subject.id}`);
      setDeleting({ subject, documents: res.consequences.documents });
    } catch (e) {
      toast({ title: "Suppression impossible", description: errorText(e, "Réessayez."), variant: "destructive" });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.del(`/api/subjects/${deleting.subject.id}?confirmDelete=true`);
      toast({ title: "Matière supprimée", description: deleting.subject.name });
      setDeleting(null);
      await load();
    } catch (e) {
      toast({ title: "Suppression impossible", description: errorText(e, "Réessayez."), variant: "destructive" });
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="typo-h1">Mes matières</h1>
          <p className="typo-subtitle mt-1">Chaque matière regroupe vos fichiers, dossiers, notes et exercices.</p>
        </div>
        <Button onClick={() => setEditing({ subject: null })} className="gap-2">
          <Plus className="h-4 w-4" aria-hidden /> Nouvelle matière
        </Button>
      </header>

      {error && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Réessayer
          </Button>
        </div>
      )}

      {subjects === null && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      )}

      {subjects?.length === 0 && (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
          <h2 className="typo-h3 mt-3">Aucune matière pour l&apos;instant</h2>
          <p className="typo-subtitle mx-auto mt-1 max-w-sm">
            Créez votre première matière, puis importez-y vos supports de cours : PDF, Word, PowerPoint, texte ou Markdown.
          </p>
          <Button className="mt-5 gap-2" onClick={() => setEditing({ subject: null })}>
            <Plus className="h-4 w-4" aria-hidden /> Créer une matière
          </Button>
        </div>
      )}

      {subjects && subjects.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((s) => (
            <li key={s.id} className="group relative rounded-xl border bg-card transition-shadow hover:shadow-md">
              <Link href={routes.subject(s.id)} className="block rounded-xl p-5 focus-visible:outline-2 focus-visible:outline-ring">
                <span className="mb-4 block h-1.5 w-12 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                <h2 className="typo-h3 pr-8">{s.name}</h2>
                <p className="typo-meta mt-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  {s._count.documents === 0 ? "Aucun fichier" : `${s._count.documents} fichier${s._count.documents > 1 ? "s" : ""}`}
                </p>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="absolute right-2 top-2 h-8 w-8" aria-label={`Actions pour ${s.name}`}>
                    <MoreVertical className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setEditing({ subject: s })}>
                    <Pencil className="mr-2 h-4 w-4" aria-hidden /> Renommer / couleur
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void askDelete(s)}>
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden /> Supprimer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <SubjectDialog
        state={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer « {deleting?.subject.name} » ?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.documents
                ? `Les ${deleting.documents} fichier(s) de cette matière, leurs originaux, ainsi que tous ses dossiers seront définitivement supprimés.`
                : "Les dossiers de cette matière seront définitivement supprimés."}{" "}
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SubjectDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { subject: SubjectDto | null } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state) {
      setName(state.subject?.name ?? "");
      setColor(state.subject?.color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)]);
      setError(null);
    }
  }, [state]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Le nom est requis.");
    setBusy(true);
    setError(null);
    try {
      if (state?.subject) await api.patch(`/api/subjects/${state.subject.id}`, { name, color });
      else await api.post("/api/subjects", { name, color });
      await onSaved();
    } catch (err) {
      setError(errorText(err, "Enregistrement impossible."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state?.subject ? "Modifier la matière" : "Nouvelle matière"}</DialogTitle>
            <DialogDescription>Par exemple : Algorithmique, Bases de données, Réseaux.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="subject-name">Nom</Label>
            <Input id="subject-name" value={name} maxLength={120} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Couleur</legend>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Couleur ${c}`}
                  aria-pressed={color === c}
                  className="h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition aria-pressed:ring-2 aria-pressed:ring-foreground"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
