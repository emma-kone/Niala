import AttemptView from "@/features/exercises/attempt-view";

export default async function AttemptPage({ params }: { params: Promise<{ id: string; exId: string; attId: string }> }) {
  const { id, exId, attId } = await params;
  return <AttemptView subjectId={id} exerciseId={exId} attemptId={attId} />;
}
