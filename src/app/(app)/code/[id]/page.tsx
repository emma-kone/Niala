import LabWorkspace from "@/features/labs/lazy-workspace";

export default async function CodeWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  return <LabWorkspace id={(await params).id} />;
}
