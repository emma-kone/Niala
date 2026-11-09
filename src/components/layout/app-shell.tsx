"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";
import { routes } from "@/config/routes";
import { useAppStore } from "@/store/app-store";
import { AuthGuard } from "@/components/layout/auth-guard";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { FloatingToolbar, useToolbarVisible } from "@/components/layout/floating-toolbar";
import { useCourseReminders } from "@/features/agenda/use-course-reminders";
import { ContextHintLayer } from "@/components/context-hint";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dashboard = pathname === routes.home;
  const toolbar = useToolbarVisible();
  // La page ne défile plus : c'est la zone de contenu qui revient en haut à chaque changement d'onglet.
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [pathname]);
  const user = useAppStore((s) => s.user);
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  useCourseReminders(!!user);

  async function logout() {
    await api.post("/api/auth/logout");
    setAuthenticated(false, null);
    router.replace(routes.login);
  }

  return (
    <AuthGuard>
      <div className="flex h-dvh overflow-hidden bg-[var(--shell)]">
        <ContextHintLayer />
        <SidebarNav user={user} onLogout={logout} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:py-3 lg:pr-3">
          <MobileNav onLogout={logout} />
          {/* --toolbar-clearance : hauteur de la barre, pour que seuls les écrans défilants laissent leur dernière ligne atteignable. */}
          <div className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:rounded-[50px]", dashboard ? "bg-[var(--dash-surface)]" : "bg-background")} style={toolbar ? ({ "--toolbar-clearance": "65px" } as React.CSSProperties) : undefined}>
            {/* Le contenu forme son propre contexte d'empilement : quels que soient ses z-index internes, la barre reste devant. */}
            <main ref={content} className={cn("relative z-0 min-h-0 min-w-0 flex-1 overflow-y-auto", toolbar && "lg:mt-4")}>{children}</main>
            <FloatingToolbar />
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
