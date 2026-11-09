import ExerciseView from "@/features/exercises/exercise-view";

export default async function StandaloneExercisePage({ params }: { params: Promise<{ exId: string }> }) {
  const { exId } = await params;
  return <ExerciseView subjectId={null} exerciseId={exId} />;
}
