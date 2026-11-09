"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Monitor, Moon, Sun, UserRound, type LucideIcon } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useTheme, type ThemeChoice } from "@/components/theme/theme-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { AppUser } from "@/store/app-store";
import { PROFILE_KEY, fetchProfile, profileSummary } from "@/features/profile/types";
import { UserAvatar } from "@/features/profile/user-avatar";

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Clair", icon: Sun },
  { value: "dark", label: "Sombre", icon: Moon },
  { value: "system", label: "Système", icon: Monitor },
];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs font-medium" title={value}>{value}</dd>
    </div>
  );
}

/** Compte de l'étudiant : résumé de son profil, thème et accès à « Mon profil » et aux paramètres. */
export function AccountMenu({ user, collapsed = false, onNavigate }: { user: AppUser | null; collapsed?: boolean; onNavigate?: () => void }) {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  // Chargé à la première ouverture seulement, puis conservé.
  const { data: profile, isError: failed } = useQuery({ queryKey: PROFILE_KEY, queryFn: fetchProfile, enabled: open });
  const name = user?.name ?? "Mon compte";

  async function changeTheme(value: ThemeChoice) {
    if (value === theme) return;
    const previous = theme;
    setTheme(value);
    try {
      await api.put("/api/settings", { theme: value });
    } catch {
      setTheme(previous);
      toast({ title: "Enregistrement impossible", description: "Le thème n'a pas pu être enregistré.", variant: "destructive" });
    }
  }

  const avatar = <UserAvatar name={user?.name} email={user?.email} avatar={profile?.avatar ?? user?.avatar} />;
  const close = () => {
    setOpen(false);
    onNavigate?.();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Compte de ${name}`} className={cn("flex min-w-0 items-center gap-1.5 rounded-full text-left transition-opacity hover:opacity-80", !collapsed && "flex-1")}>
          {avatar}
          {!collapsed && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{name}</span>
              <span className="block truncate text-[11px] text-sidebar-foreground/75">{user?.email}</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={10} className="w-72 space-y-3 rounded-3xl p-4">
        <div className="flex items-center gap-2.5">
          {avatar}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="truncate text-xs text-muted-foreground" title={user?.email}>{user?.email}</p>
          </div>
        </div>

        <div role="group" aria-label="Thème" className="grid grid-cols-3 gap-1 rounded-2xl bg-muted/60 p-1">
          {THEMES.map((t) => (
            <button key={t.value} type="button" aria-pressed={theme === t.value} onClick={() => void changeTheme(t.value)} className={cn("flex items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-medium transition-colors", theme === t.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <t.icon className="h-3.5 w-3.5" aria-hidden /> {t.label}
            </button>
          ))}
        </div>

        {failed ? (
          <p role="status" className="text-xs text-muted-foreground">Informations du compte indisponibles pour l&apos;instant.</p>
        ) : !profile ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-full" />
          </div>
        ) : (
          <dl className="space-y-1.5">
            {profileSummary(profile).map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
            {!profile.category && <p className="text-xs text-muted-foreground">Complétez votre parcours pour des exercices adaptés.</p>}
          </dl>
        )}

        <div className="grid gap-1.5">
          <Link href={routes.profile} onClick={close} className="flex items-center justify-between rounded-2xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
            <span className="flex items-center gap-2"><UserRound className="h-4 w-4" aria-hidden /> Mon profil</span> <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <Link href={routes.settings} onClick={close} className="flex items-center justify-between rounded-2xl bg-muted/60 px-3 py-2 text-sm font-medium transition-colors hover:bg-muted">
            Paramètres <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
