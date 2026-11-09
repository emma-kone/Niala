import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { routes } from "@/config/routes";
import { sessionBootstrap } from "@/server/services/session";

// La session et les préférences sont lues ici, côté serveur : la structure de l'application s'affiche
// dès la première réponse, sans attendre un aller-retour du navigateur pour savoir qui est connecté.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect(routes.login);
  return <AppShell initial={await sessionBootstrap(user)}>{children}</AppShell>;
}
