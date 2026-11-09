"use client";

import { useSearchParams } from "next/navigation";
import CreateExerciseView from "./create-view";

export default function CreateExercisePage({ subjectId }: { subjectId: string | null }) {
  const params = useSearchParams();
  return <CreateExerciseView subjectId={subjectId} documentId={params.get("document")} presetConcepts={params.get("concepts")?.split(",").filter(Boolean) ?? []} initialSource={params.get("source")} preset={{ subject: params.get("subject"), chapter: params.get("chapter"), difficulty: params.get("difficulty"), count: params.get("count"), mode: params.get("mode") }} />;
}
