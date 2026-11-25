"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Box, Loader2, Plus, Square, Workflow } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { routes } from "@/config/routes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmAction } from "@/components/notifications";
import { useCachedState } from "@/hooks/use-cached-state";
import { useBackgroundRefresh } from "@/hooks/use-background-refresh";
import { LabListSkeleton } from "@/features/labs/lab-skeletons";
import type { LabListItem } from "@/features/labs/types";
import { diagramUiKey, LAST_DIAGRAM_KEY } from "./storage-keys";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const KINDS = [
  { id: "mcd" as const, label: "MCD (Merise)", text: "Entités, associations, identifiants et cardinalités. Le MLD est déduit automatiquement.", icon: Square },
  { id: "uml" as const, label: "Diagramme de classes UML", text: "Classes, attributs, opérations, héritage, composition, agrégation et multiplicités.", icon: Box },
];

export default function DiagramHome() {
  const router = useRouter();
  const [items, setItems] = useCachedState<LabListItem[] | null>(["labs", "DIAGRAM"], null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"mcd" | "uml">("mcd");
  const [title, setTitle] = useState("");
  // En revenant au module, on retrouve le dernier diagramme ouvert ; « ?liste=1 » (fil d'Ariane) montre la liste.
  const [resuming, setResuming] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.get<{ workspaces: LabListItem[] }>("/api/labs?kind=DIAGRAM")).workspaces);
      setError(null);
    } catch (e) {
      setError(errText(e, "Chargement impossible."));
    }
  }, [setItems]);
  useBackgroundRefresh(load, { topics: ["labs"] });

  useEffect(() => {
    const list = new URLSearchParams(window.location.search).has("liste");
    const last = localStorage.getItem(LAST_DIAGRAM_KEY);
    if (list) localStorage.removeItem(LAST_DIAGRAM_KEY);
    else if (last) {
      router.replace(`${routes.diagrams}/${last}`);
      return;
    }
    setResuming(false);
    void load();
  }, [load, router]);

  async function create() {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api.post<{ workspace: { id: string } }>("/api/labs", { from: "diagram", diagramKind: kind, ...(title.trim() ? { title: title.trim() } : {}) });
      router.push(`${routes.diagrams}/${r.workspace.id}`);
    } catch (e) {
      setActionError(errText(e, "Création impossible."));
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!(await confirmAction(`Supprimer « ${name} » ?`, { confirmLabel: "Supprimer" }))) return;
    try {
      await api.del(`/api/labs/${id}`);
      if (localStorage.getItem(LAST_DIAGRAM_KEY) === id) localStorage.removeItem(LAST_DIAGRAM_KEY);
      localStorage.removeItem(diagramUiKey(id));
      void load();
    } catch (e) {
      setActionError(errText(e, "Suppression impossible."));
    }
  }

  if (resuming) return <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"><LabListSkeleton /></div>;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="typo-h1 flex items-center gap-2"><Workflow className="h-6 w-6" aria-hidden /> Laboratoire de diagrammes</h1>
      <p className="typo-subtitle mt-1">Construisez vos MCD et vos diagrammes de classes UML, placez les cardinalités, importez le sujet de l&apos;exercice et travaillez avec l&apos;assistant IA, qui voit votre diagramme et peut le modifier avec vous.</p>

      <section aria-label="Nouveau diagramme" className="mt-5 rounded-xl border bg-card p-4">
        <h2 className="typo-h3">Nouveau diagramme</h2>
        <div role="radiogroup" aria-label="Type de diagramme" className="mt-3 grid gap-3 sm:grid-cols-2">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} onClick={() => setKind(k.id)} className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors", kind === k.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted")}>
              <k.icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{k.label}</span>
                <span className="block text-xs text-muted-foreground">{k.text}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Input aria-label="Titre" placeholder={kind === "mcd" ? "Titre (ex. Gestion d'une bibliothèque)" : "Titre (ex. Réservation de vols)"} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="w-72" />
          <Button className="gap-2" onClick={() => void create()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Créer</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Le sujet de l&apos;exercice (texte collé, PDF ou images) s&apos;ajoute ensuite dans l&apos;onglet « Sujet » du diagramme.</p>
        {actionError && <p role="alert" className="mt-2 text-sm text-destructive">{actionError}</p>}
      </section>

      <h2 className="typo-h3 mb-2 mt-8">Mes diagrammes</h2>
      {error ? (
        <Alert variant="destructive"><AlertTitle>Chargement impossible</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>
      ) : !items ? (
        <LabListSkeleton />
      ) : items.length === 0 ? (
        <p className="typo-subtitle rounded-xl border border-dashed p-6 text-center">Aucun diagramme pour l&apos;instant. Créez-en un ci-dessus.</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map((w) => (
            <li key={w.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`${routes.diagrams}/${w.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{w.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-normal">{w.language === "uml" ? "UML" : "MCD"}</Badge>
                  <span>{w.mode === "EXERCISE" ? "Exercice avec sujet" : "Libre"}</span>
                  <span>modifié le {new Date(w.updatedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</span>
                </span>
              </Link>
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void remove(w.id, w.title)} aria-label={`Supprimer ${w.title}`}>Supprimer</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
