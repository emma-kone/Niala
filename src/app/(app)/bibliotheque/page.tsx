import { redirect } from "next/navigation";
import { routes } from "@/config/routes";

// Ancienne adresse : la bibliothèque à chapitres a été remplacée par « Mes matières ».
export default function LegacyLibraryPage() {
  redirect(routes.subjects);
}
