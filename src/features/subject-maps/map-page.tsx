"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Button } from "@/components/ui/button";
import type { MapDetail } from "@/features/maps/types";

// React Flow dépend du navigateur : jamais rendu côté serveur
const MapEditor = dynamic(() => import("@/features/maps/map-editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement de l&apos;éditeur…
    </div>
  ),
});

export default function MapPage({ subjectId, mapId }: { subjectId: string; mapId: string }) {
  const [map, setMap] = useState<MapDetail | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ map: MapDetail }>(`/api/maps/${mapId}`)
      .then((r) => {
        if (cancelled) return;
        if (r.map.subjectId !== subjectId) setError({ message: "Carte introuvable.", status: 404 });
        else setMap(r.map);
      })
      .catch((e) => !cancelled && setError({ message: e instanceof Error ? e.message : "Chargement impossible.", status: (e as { status?: number }).status }));
    return () => {
      cancelled = true;
    };
  }, [mapId, subjectId]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">{error.status === 404 ? "Carte introuvable" : "Chargement impossible"}</h1>
        <p className="typo-subtitle mt-2">{error.message}</p>
        <Button asChild variant="outline" className="mt-6"><Link href={`${routes.subject(subjectId)}/cartes`}>Retour aux cartes</Link></Button>
      </div>
    );
  }
  if (!map) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Chargement de la carte…
      </div>
    );
  }
  return <MapEditor key={map.id} map={map} />;
}
