"use client";

import dynamic from "next/dynamic";
import { LabWorkspaceSkeleton } from "./lab-skeletons";

// Les éditeurs CodeMirror pèsent lourd : l'espace de travail les charge après l'affichage de sa structure.
const LabWorkspace = dynamic(() => import("./lab-workspace"), {
  ssr: false,
  loading: () => <LabWorkspaceSkeleton />,
});

export default LabWorkspace;
