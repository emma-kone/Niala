import { Suspense } from "react";
import SubjectNotesView from "@/features/subject-notes/notes-view";

export default async function SubjectNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <SubjectNotesView subjectId={id} />
    </Suspense>
  );
}
