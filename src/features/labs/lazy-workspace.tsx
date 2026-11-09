"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// Les éditeurs CodeMirror pèsent lourd : l'espace de travail les charge après l'affichage de sa structure.
const LabWorkspace = dynamic(() => import("./lab-workspace"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[calc(100dvh-6rem)] gap-3 p-4 lg:grid-cols-2" aria-busy>
      <Skeleton className="rounded-3xl" />
      <Skeleton className="rounded-3xl" />
    </div>
  ),
});

export default LabWorkspace;
