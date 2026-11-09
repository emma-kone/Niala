import { Suspense } from "react";
import CreateExercisePage from "@/features/exercises/create-page";

export default function NewFreeExercisePage() {
  return (
    <Suspense fallback={null}>
      <CreateExercisePage subjectId={null} />
    </Suspense>
  );
}
