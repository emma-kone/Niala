import { redirect } from "next/navigation";
import { getPendingLink } from "@/lib/auth";
import { routes } from "@/config/routes";
import LinkGoogleView from "@/features/auth/link-google-view";

export const metadata = { title: "Lier votre compte Google · Niala", robots: { index: false } };

// Page publique : elle n'existe que pour un retour Google en attente de confirmation (cookie signé de 10 minutes).
export default async function LinkGooglePage() {
  const pending = await getPendingLink();
  if (!pending) redirect(routes.login);
  return <LinkGoogleView email={pending.email} />;
}
