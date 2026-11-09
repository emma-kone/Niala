"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, GraduationCap, LogOut } from "lucide-react";
import { AccountMenu } from "@/components/layout/account-menu";
import { NAV_GROUPS, isNavActive } from "@/config/navigation";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/store/app-store";

interface SidebarNavProps {
  user: AppUser | null;
  onLogout: () => void;
}

const KEY = "niala-sidebar-collapsed";
const EVENT = "niala-sidebar-change";

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}
function setCollapsed(value: boolean) {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* stockage indisponible : la préférence ne sera pas mémorisée */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function SidebarNav({ user, onLogout }: SidebarNavProps) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  return (
    <aside
      className={cn("sticky top-3 z-30 m-3 mr-10 hidden h-[calc(100vh-1.5rem)] shrink-0 flex-col rounded-[50px] rounded-tr-[26px] bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex", collapsed ? "w-16" : "w-44 xl:w-48")}
      aria-label="Navigation principale"
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Déplier la barre latérale" : "Réduire la barre latérale"}
        aria-expanded={!collapsed}
        className="absolute -right-[22px] top-[53px] z-10 group flex h-11 w-11 items-center justify-center rounded-full bg-sidebar"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--niala-accent)] text-[var(--niala-accent-foreground)] transition-transform group-hover:scale-110">
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" aria-hidden /> : <ChevronLeft className="h-3.5 w-3.5" aria-hidden />}
        </span>
      </button>

      <div className={cn("flex h-[108px] shrink-0 items-start gap-2 pt-7", collapsed ? "justify-center px-2" : "px-5")}>
        <GraduationCap className="h-6 w-6 shrink-0" aria-hidden />
        {!collapsed && <span className="text-xl font-bold tracking-tight">Niala</span>}
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2.5 pb-3">
        {NAV_GROUPS.map((group, n) => (
          <div key={group.label}>
            {n > 0 && <div className="mx-2 mb-3 border-t border-sidebar-border" aria-hidden />}
            {!collapsed && <p className="mb-1.5 px-3 text-[11px] text-sidebar-foreground/70">{group.label}</p>}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-xl py-2 text-[13px] transition-colors",
                        collapsed ? "justify-center px-2" : "px-2.5",
                        active ? "niala-nav-active bg-[var(--nav-active)] font-medium text-[var(--nav-active-foreground)]" : "text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn("mx-2 mb-3 flex items-center gap-1.5 rounded-[38px] bg-sidebar-accent p-2", collapsed && "flex-col")}>
        <AccountMenu user={user} collapsed={collapsed} />
        <button type="button" onClick={onLogout} aria-label="Se déconnecter" title="Se déconnecter" className="rounded-lg p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-border hover:text-sidebar-foreground">
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </aside>
  );
}
