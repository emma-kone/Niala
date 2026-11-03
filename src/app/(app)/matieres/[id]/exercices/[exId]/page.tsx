import ExerciseView from "@/features/exercises/exercise-view";

export default async function ExercisePage({ params }: { params: Promise<{ id: string; exId: string }> }) {
  const { id, exId } = await params;
  return <ExerciseView subjectId={id} exerciseId={exId} />;
}
