"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { useAppStore } from "@/store/app-store";
import { AuthGuard } from "@/components/layout/auth-guard";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { MobileNav } from "@/components/layout/mobile-nav";
import { AppFooter } from "@/components/layout/app-footer";
import { FloatingToolbar } from "@/components/layout/floating-toolbar";
import { useCourseReminders } from "@/features/agenda/use-course-reminders";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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
      <div className="flex min-h-screen bg-[var(--shell)]">
        <SidebarNav user={user} onLogout={logout} />
        <div className="flex min-w-0 flex-1 flex-col md:py-3 md:pr-3">
          <MobileNav onLogout={logout} />
          <main className="flex min-w-0 flex-1 flex-col bg-background md:rounded-[32px]">
            <div className="min-w-0 flex-1">{children}</div>
            <FloatingToolbar />
          </main>
          <AppFooter />
        </div>
      </div>
    </AuthGuard>
  );
}
