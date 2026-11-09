import MapPage from "@/features/subject-maps/map-page";

export default async function StandaloneMapPage({ params }: { params: Promise<{ mapId: string }> }) {
  const { mapId } = await params;
  return <MapPage subjectId={null} mapId={mapId} />;
}
