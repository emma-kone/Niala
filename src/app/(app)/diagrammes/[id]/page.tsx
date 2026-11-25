import DiagramWorkspace from "@/features/diagrams/lazy-workspace";

export default async function DiagramWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  return <DiagramWorkspace id={(await params).id} />;
}
