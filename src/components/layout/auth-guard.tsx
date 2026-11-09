"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { routes } from "@/config/routes";
import { useAppStore } from "@/store/app-store";

/** La session est vérifiée par la mise en page serveur ; seule une déconnexion en cours de navigation est traitée ici. */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const authenticated = useAppStore((s) => s.authenticated);

  useEffect(() => {
    if (authenticated === false) router.replace(routes.login);
  }, [authenticated, router]);

  return authenticated === false ? null : <>{children}</>;
}
