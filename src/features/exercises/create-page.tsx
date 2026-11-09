"use client";

import { useSearchParams } from "next/navigation";
import CreateExerciseView from "./create-view";

export default function CreateExercisePage({ subjectId }: { subjectId: string | null }) {
  const params = useSearchParams();
  return <CreateExerciseView subjectId={subjectId} documentId={params.get("document")} presetConcepts={params.get("concepts")?.split(",").filter(Boolean) ?? []} initialSource={params.get("source")} />;
}
