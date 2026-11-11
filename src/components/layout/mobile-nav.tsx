"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu } from "lucide-react";
import { NialaLogo, NialaMark, NialaWordmark } from "@/components/brand/niala-logo";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AccountMenu } from "@/components/layout/account-menu";
import { NAV_GROUPS, isNavActive } from "@/config/navigation";
import { cn } from "@/lib/utils";
import type { AppUser } from "@/store/app-store";

/** En dessous de 1024 px : une barre compacte et un menu burger qui reprend la navigation complète. */
export function MobileNav({ user, onLogout }: { user: AppUser | null; onLogout: () => void }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 bg-sidebar px-3 py-2 text-sidebar-foreground lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button type="button" aria-label="Ouvrir le menu" className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--niala-accent)] text-[var(--niala-accent-foreground)]">
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        </SheetTrigger>
        <SheetContent side="left" className="flex w-[280px] flex-col gap-0 border-0 bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="flex items-center gap-2.5 px-6 py-5 text-sidebar-foreground">
            <NialaMark size="md" tone="accent" />
            <NialaWordmark size="md" />
          </SheetTitle>
          <nav aria-label="Navigation principale" className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
            {NAV_GROUPS.map((group, n) => (
              <div key={group.label}>
                {n > 0 && <div className="mx-2 mb-3 border-t border-sidebar-border" aria-hidden />}
                <p className="mb-1.5 px-3 text-[11px] text-sidebar-foreground/70">{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isNavActive(pathname, item);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          prefetch
                          aria-current={active ? "page" : undefined}
                          onClick={() => setOpen(false)}
                          className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm", active ? "bg-[var(--nav-active)] font-medium text-[var(--nav-active-foreground)]" : "text-sidebar-foreground/85 hover:bg-sidebar-accent")}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden /> {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="m-3 flex items-center gap-2 rounded-2xl bg-sidebar-accent p-2">
            <AccountMenu user={user} onNavigate={() => setOpen(false)} />
            <button type="button" onClick={onLogout} aria-label="Se déconnecter" className="rounded-lg p-1.5 hover:bg-sidebar-border">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <NialaLogo size="sm" tone="accent" className="gap-2" />
    </header>
  );
}
