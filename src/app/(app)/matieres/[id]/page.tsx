import { Suspense } from "react";
import SubjectFilesView from "@/features/subject-files/files-view";

export default async function SubjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={null}>
      <SubjectFilesView subjectId={id} />
    </Suspense>
  );
}
