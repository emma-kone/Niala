import { Suspense } from "react";
import AgendaView from "@/features/agenda/agenda-view";

export default function AgendaPage() {
  return (
    <Suspense>
      <AgendaView />
    </Suspense>
  );
}
