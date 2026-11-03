"use client";

import { useEffect, useMemo, useState } from "react";
import { Folder, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { descendantIds, type FolderNode } from "@/server/domain/folder-tree";
import { cn } from "@/lib/utils";

/** Boîte de dialogue de saisie d'un nom (création / renommage). */
export function NameDialog({
  open,
  title,
  description,
  initial,
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  initial: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initial);
      setError(null);
    }
  }, [open, initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Le nom est requis.");
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="name-input">Nom</Label>
            <Input id="name-input" value={name} autoFocus maxLength={120} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          </div>
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
              {busy ? "…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Choix d'un dossier de destination ; les dossiers déplacés et leurs descendants sont désactivés. */
export function MoveDialog({
  open,
  tree,
  movingFolderIds,
  count,
  currentFolderId,
  onClose,
  onMove,
}: {
  open: boolean;
  tree: FolderNode[];
  movingFolderIds: string[];
  count: number;
  currentFolderId: string | null;
  onClose: () => void;
  onMove: (target: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTarget(null);
      setError(null);
    }
  }, [open]);

  const blocked = useMemo(() => {
    const s = new Set<string>();
    for (const id of movingFolderIds) {
      s.add(id);
      descendantIds(tree, id).forEach((d) => s.add(d));
    }
    return s;
  }, [tree, movingFolderIds]);

  // Liste aplatie, indentée selon la profondeur
  const rows = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      tree
        .filter((f) => f.parentId === parent)
        .sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true }))
        .forEach((f) => {
          out.push({ id: f.id, name: f.name, depth });
          walk(f.id, depth + 1);
        });
    };
    walk(null, 0);
    return out;
  }, [tree]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onMove(target);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Déplacement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Déplacer {count} élément{count > 1 ? "s" : ""}</DialogTitle>
          <DialogDescription>Choisissez le dossier de destination.</DialogDescription>
        </DialogHeader>
        <div role="listbox" aria-label="Dossiers" className="max-h-72 overflow-y-auto rounded-lg border p-1">
          {[{ id: null as string | null, name: "Racine de la matière", depth: 0 }, ...rows.map((r) => ({ ...r, id: r.id as string | null }))].map((r) => {
            const disabled = r.id !== null && blocked.has(r.id);
            const selected = target === r.id;
            return (
              <button
                key={r.id ?? "root"}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => setTarget(r.id)}
                style={{ paddingLeft: 8 + r.depth * 18 }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm",
                  selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
                )}
              >
                {selected ? <FolderOpen className="h-4 w-4 shrink-0" aria-hidden /> : <Folder className="h-4 w-4 shrink-0" aria-hidden />}
                <span className="truncate">{r.name}</span>
                {r.id === currentFolderId && <span className="ml-auto text-xs opacity-70">actuel</span>}
              </button>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={() => void submit()} disabled={busy || target === currentFolderId}>
            {busy ? "Déplacement…" : "Déplacer ici"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
