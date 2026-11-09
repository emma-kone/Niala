import AttemptView from "@/features/exercises/attempt-view";

export default async function StandaloneAttemptPage({ params }: { params: Promise<{ exId: string; attId: string }> }) {
  const { exId, attId } = await params;
  return <AttemptView subjectId={null} exerciseId={exId} attemptId={attId} />;
}
