import MapPage from "@/features/subject-maps/map-page";

export default async function SubjectMapPage({ params }: { params: Promise<{ id: string; mapId: string }> }) {
  const { id, mapId } = await params;
  return <MapPage subjectId={id} mapId={mapId} />;
}
