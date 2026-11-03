import LabWorkspace from "@/features/labs/lab-workspace";

export default async function SqlWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  return <LabWorkspace id={(await params).id} />;
}
