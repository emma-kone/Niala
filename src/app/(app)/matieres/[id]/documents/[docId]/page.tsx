import { Suspense } from "react";
import ReaderView from "@/features/reader/reader-view";

export default async function ReaderPage({ params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  return (
    <Suspense fallback={null}>
      <ReaderView subjectId={id} docId={docId} />
    </Suspense>
  );
}
