import { Suspense } from "react";
import SubjectsView from "@/features/subjects/subjects-view";

export default function SubjectsPage() {
  return (
    <Suspense>
      <SubjectsView />
    </Suspense>
  );
}
