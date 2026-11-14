"use client";

import { useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { api } from "@/lib/client-api";
import { STREAK_KEY } from "@/features/streak/use-streak";
import { cn } from "@/lib/utils";
import { routes } from "@/config/routes";
import { useAppStore } from "@/store/app-store";
import { AuthGuard } from "@/components/layout/auth-guard";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { FloatingToolbar, useToolbarVisible } from "@/components/layout/floating-toolbar";
import { useCourseReminders } from "@/features/agenda/use-course-reminders";
import { useRevisionReminder } from "@/features/settings/use-revision-reminder";
import { SETTINGS_KEY, useSettings } from "@/features/settings/use-settings";
import { ContextHintLayer } from "@/components/context-hint";
import { StudentTracking } from "@/features/support/student-tracking";
import { ProductTour } from "@/components/tour/product-tour";
import { ProfileRequiredModal } from "@/components/layout/profile-required-modal";
import { AgentLauncher } from "@/components/ai-agent/agent-launcher";
import { STUDENT_TOUR, STUDENT_TOUR_ID } from "@/features/tour/steps";
import { applyTextSize, isThemeChoice, useTheme } from "@/components/theme/theme-provider";
import type { SessionBootstrap } from "@/server/services/session";

/** Les données déjà chargées restent affichées pendant leur actualisation : changer de module ne repart plus de zéro. */
function makeQueryClient(initial: SessionBootstrap) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, gcTime: 30 * 60_000, retry: 1, refetchOnWindowFocus: true, refetchOnReconnect: true } } });
  if (initial.settings) client.setQueryData(SETTINGS_KEY, initial.settings);
  return client;
}

export function AppShell({ children, initial }: { children: React.ReactNode; initial: SessionBootstrap }) {
  const [client] = useState(() => makeQueryClient(initial));
  return (
    <QueryClientProvider client={client}>
      <Shell initial={initial}>{children}</Shell>
    </QueryClientProvider>
  );
}

function Shell({ children, initial }: { children: React.ReactNode; initial: SessionBootstrap }) {
  const pathname = usePathname();
  const dashboard = pathname === routes.home;
  const toolbar = useToolbarVisible();
  // La page ne défile plus : c'est la zone de contenu qui revient en haut à chaque changement d'onglet.
  const content = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
    // Une activité a pu avoir lieu sur la page quittée : la série est relue, mais seulement si elle a plus d'une minute.
    void queryClient.refetchQueries({ queryKey: STREAK_KEY, stale: true });
  }, [pathname, queryClient]);
  // Le compte connu du serveur sert dès le premier rendu, avant que le magasin côté navigateur ne soit renseigné.
  const storedUser = useAppStore((s) => s.user);
  const user = storedUser ?? initial.user;
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  const { syncTheme } = useTheme();
  const { settings } = useSettings();
  useCourseReminders(settings?.notifyActivities ?? false);
  useRevisionReminder(settings?.notifyRevision ?? false);

  useEffect(() => {
    setAuthenticated(true, initial.user);
    if (isThemeChoice(initial.settings?.theme)) syncTheme(initial.settings.theme);
    if (initial.settings) applyTextSize(initial.settings.textSize);
  }, [initial, setAuthenticated, syncTheme]);

  async function logout() {
    await api.post("/api/auth/logout");
    window.location.replace(routes.login);
  }

  return (
    <AuthGuard>
      <div className="flex h-dvh overflow-hidden bg-[var(--shell)]">
        <ContextHintLayer />
        <StudentTracking />
        <ProductTour tourId={STUDENT_TOUR_ID} version={1} userKey={user?.id ?? "anonyme"} steps={STUDENT_TOUR} />
        <AgentLauncher />
        <ProfileRequiredModal user={user} />
        <SidebarNav user={user} onLogout={logout} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:py-3 lg:pr-3">
          <MobileNav user={user} onLogout={logout} />
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
