import ExercisesView from "@/features/exercises/exercises-view";

export default async function SubjectExercisesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExercisesView subjectId={id} />;
}
