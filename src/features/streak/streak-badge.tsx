"use client";

import Link from "next/link";
import { Flame } from "lucide-react";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { useStreak } from "@/features/streak/use-streak";

/** Indicateur compact de la série de jours, visible sur toutes les pages. Discret tant que rien n'est chargé. */
export function StreakBadge({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const { data } = useStreak();
  if (!data) return null;
  const label = data.current > 0 ? `${data.current} jour${data.current > 1 ? "s" : ""} d'affilée` : "Aucune série en cours";
  const state = data.doneToday ? "fait aujourd'hui" : "à faire aujourd'hui";
  return (
    <Link
      href={routes.home}
      title={`${label} · ${state} · record : ${data.longest} jour${data.longest > 1 ? "s" : ""}`}
      aria-label={`Série de jours : ${label}, ${state}. Record : ${data.longest}.`}
      data-testid="streak-badge"
      className={cn("flex items-center gap-2 rounded-2xl bg-sidebar-accent px-3 py-2 text-[13px] font-medium hover:bg-sidebar-border", collapsed && "justify-center px-2", className)}
    >
      <Flame className={cn("h-4 w-4 shrink-0", data.doneToday && data.current > 0 ? "text-[var(--accent-sun)]" : "text-[var(--streak-orange)]")} aria-hidden />
      {collapsed ? <span className="tnum text-xs">{data.current}</span> : (
        <span className="min-w-0 truncate">
          <span className="tnum">{data.current}</span> jour{data.current > 1 ? "s" : ""}
          {!data.doneToday && data.current > 0 && <span className="ml-1 text-[11px] font-normal opacity-70">· à faire</span>}
        </span>
      )}
    </Link>
  );
}
