"use client";

import { useSearchParams } from "next/navigation";
import CreateExerciseView, { ADAPTATIONS, type Adaptation } from "./create-view";

export default function CreateExercisePage({ subjectId }: { subjectId: string }) {
  const params = useSearchParams();
  return <CreateExerciseView subjectId={subjectId} documentId={params.get("document")} presetConcepts={params.get("concepts")?.split(",").filter(Boolean) ?? []} adaptation={ADAPTATIONS.has(params.get("adapt") ?? "") ? (params.get("adapt") as Adaptation) : undefined} />;
}
