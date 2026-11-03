import SubjectMapsView from "@/features/subject-maps/maps-view";

export default async function SubjectMapsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SubjectMapsView subjectId={id} />;
}
