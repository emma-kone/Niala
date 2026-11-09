"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Loader2, Network, Sparkles } from "lucide-react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MapDetail } from "./types";

// React Flow dépend du navigateur : l'éditeur n'est chargé qu'à l'ouverture de la carte.
const MapEditor = dynamic(() => import("./map-editor"), { ssr: false, loading: () => <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement de l&apos;éditeur…</div> });

interface Generated {
  id: string;
  nodes: number;
  notice: string | null;
}

/**
 * « Générer une carte mentale avec l'IA » : depuis le cours consulté (entier ou par pages), sans quitter la page.
 * La carte créée s'ouvre dans une fenêtre éditable et reste enregistrée dans les cartes de l'étudiant.
 */
export function MindMapDialog({ documentId, documentName, pageCount, trigger }: { documentId: string; documentName: string; pageCount: number | null; trigger: (open: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<MapDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const pageFrom = from ? Number(from) : undefined;
      const pageTo = to ? Number(to) : undefined;
      const r = await api.post<Generated>("/api/maps/from-content", { documentId, ...(pageFrom ? { pageFrom, pageTo: pageTo ?? pageFrom } : {}) });
      setMap((await api.get<{ map: MapDetail }>(`/api/maps/${r.id}`)).map);
      setNotice(r.notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "La carte n'a pas pu être générée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {trigger(() => setOpen(true))}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setMap(null); setNotice(null); setError(null); } }}>
        <DialogContent className={map ? "h-[90dvh] w-[96vw] max-w-6xl gap-0 overflow-hidden p-0 sm:max-w-6xl" : "sm:max-w-md"}>
          {map ? (
            <>
              <DialogHeader className="sr-only"><DialogTitle>{map.title}</DialogTitle><DialogDescription>Carte mentale générée, modifiable et enregistrée automatiquement.</DialogDescription></DialogHeader>
              {notice && <p role="note" className="border-b bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{notice}</p>}
              <div className="min-h-0 flex-1"><MapEditor key={map.id} map={map} embedded /></div>
            </>
          ) : (
            <form onSubmit={generate} className="space-y-4">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Network className="h-5 w-5" aria-hidden /> Carte mentale de ce cours</DialogTitle>
                <DialogDescription>L&apos;IA lit « {documentName} », en dégage les parties, les notions, les définitions et leurs relations, puis construit une carte que vous pouvez modifier.</DialogDescription>
              </DialogHeader>
              <fieldset className="space-y-2" disabled={busy}>
                <legend className="text-sm font-medium">Partie du cours <span className="font-normal text-muted-foreground">(facultatif)</span></legend>
                <div className="flex items-end gap-2">
                  <div className="space-y-1"><Label htmlFor="mm-from" className="text-xs">De la page</Label><Input id="mm-from" type="number" min={1} max={pageCount ?? undefined} className="w-24" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="1" /></div>
                  <div className="space-y-1"><Label htmlFor="mm-to" className="text-xs">À la page</Label><Input id="mm-to" type="number" min={Number(from) || 1} max={pageCount ?? undefined} className="w-24" value={to} onChange={(e) => setTo(e.target.value)} placeholder={pageCount ? String(pageCount) : ""} /></div>
                </div>
                <p className="typo-meta">Vide : tout le cours{pageCount ? ` (${pageCount} pages)` : ""}.</p>
              </fieldset>
              {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full gap-2" disabled={busy || (!!from && !!to && Number(to) < Number(from))}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} {busy ? "Analyse du cours en cours…" : "Générer la carte"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
