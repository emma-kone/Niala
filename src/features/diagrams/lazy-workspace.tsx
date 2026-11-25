"use client";

import dynamic from "next/dynamic";
import { DiagramWorkspaceSkeleton } from "./diagram-skeletons";

// L'éditeur est chargé après l'affichage de sa structure.
const DiagramWorkspace = dynamic(() => import("./diagram-workspace"), {
  ssr: false,
  loading: () => <DiagramWorkspaceSkeleton />,
});

export default DiagramWorkspace;
