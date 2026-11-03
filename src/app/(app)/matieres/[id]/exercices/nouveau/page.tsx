import { Suspense } from "react";
import CreateExercisePage from "@/features/exercises/create-page";

export default async function NewExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <CreateExercisePage subjectId={id} />
    </Suspense>
  );
}
