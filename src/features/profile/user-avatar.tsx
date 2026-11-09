import { cn } from "@/lib/utils";

/** Photo de l'étudiant, ou l'initiale de son nom sur la couleur d'accent de Niala. */
export function UserAvatar({ name, email, avatar, className }: { name?: string | null; email?: string | null; avatar?: string | null; className?: string }) {
  const initial = (name?.trim() || email || "?").charAt(0).toUpperCase();
  if (avatar) {
    // Image déjà réduite, stockée en data: : next/image n'apporterait aucune optimisation ici.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt="" className={cn("h-7 w-7 shrink-0 rounded-full object-cover", className)} />;
  }
  return <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-sun)] text-sm font-semibold text-on-pastel", className)} aria-hidden>{initial}</span>;
}
