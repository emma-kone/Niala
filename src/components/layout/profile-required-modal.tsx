"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { routes } from "@/config/routes";
import type { AppUser } from "@/store/app-store";

// Fenêtre imposée aux comptes Google dont le parcours (profil, établissement, classe / filière) n'est pas renseigné.
// Elle ne se ferme ni par une croix, ni par Échap, ni en cliquant à côté : elle disparaît d'elle-même dès que le parcours est
// enregistré (la page Profil met à jour `profileComplete`). Elle s'efface seulement sur les pages où l'on complète le parcours.

const FORM_PAGES = [routes.profile, routes.settings];

export function ProfileRequiredModal({ user }: { user: AppUser | null | undefined }) {
  const pathname = usePathname();
  const required = !!user && user.viaGoogle === true && user.profileComplete === false;
  const onForm = FORM_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!required || onForm) return null;

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="z-[70] sm:max-w-md"
      >
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-5 w-5" aria-hidden /></div>
          <DialogTitle>Complétez votre profil</DialogTitle>
          <DialogDescription>
            Bienvenue sur Niala ! Pour que les exercices et les explications soient adaptés à votre niveau, renseignez votre parcours (profil, établissement, classe ou filière) dans votre profil, accessible depuis les paramètres.
          </DialogDescription>
        </DialogHeader>
        <Button asChild className="w-full">
          <Link href={`${routes.profile}#profile-academic`}>Compléter mon profil</Link>
        </Button>
        <p className="text-center text-xs text-muted-foreground">Ce message disparaîtra dès que la section « Parcours » sera remplie.</p>
      </DialogContent>
    </Dialog>
  );
}
