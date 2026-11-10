"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Activity, Bell, Bot, ChevronDown, Compass, FileBarChart, Gauge, GraduationCap, Inbox, LayoutDashboard, Layers, LogOut, Megaphone, Menu, ScrollText, Settings, ShieldCheck, Users, X, Zap, type LucideIcon } from "lucide-react";
import { NialaMark, NialaWordmark } from "@/components/brand/niala-logo";
import { cn } from "@/lib/utils";
import { api } from "@/lib/client-api";
import { notify } from "@/components/notifications";
import { PERIOD_KEYS, PERIOD_LABELS } from "@/components/admin/period";
import { ProductTour, startTour } from "@/components/tour/product-tour";
import { ADMIN_TOUR, ADMIN_TOUR_ID } from "@/features/tour/steps";

const ICONS: Record<string, LucideIcon> = { overview: LayoutDashboard, users: Users, usage: Activity, features: Layers, pedagogy: GraduationCap, requests: Inbox, reports: FileBarChart, tech: Gauge, ai: Bot, comms: Megaphone, settings: Settings, audit: ScrollText };

export interface ShellProps {
  admin: { id: string; name: string | null; email: string; roleLabel: string };
  sections: { key: string; href: string; label: string }[];
  bell: { alerts: { id: string; title: string; severity: string; detail: string | null }[]; newRequests: number; canSeeRequests: boolean; canSeeTech: boolean };
  quick: { href: string; label: string }[];
  children: React.ReactNode;
}

/** Pages dont les chiffres dépendent de la période d'analyse. */
const PERIOD_PAGES = ["/admin", "/admin/activite", "/admin/fonctionnalites", "/admin/pedagogie", "/admin/demandes", "/admin/rapports", "/admin/performance", "/admin/ia"];

export function AdminShell({ admin, sections, bell, quick, children }: ShellProps) {
  const pathname = usePathname();
  // Le menu mobile se referme de lui-même à chaque changement de page : il n'est « ouvert » que pour la page où on l'a ouvert.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const setOpen = (value: boolean) => setOpenFor(value ? pathname : null);
  const showPeriod = PERIOD_PAGES.includes(pathname);

  const nav = (
    <nav aria-label="Rubriques du back-office" className="flex flex-col gap-0.5 px-3 pb-4">
      {sections.map((s) => {
        const Icon = ICONS[s.key] ?? LayoutDashboard;
        const active = s.href === "/admin" ? pathname === "/admin" : pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors", active ? "bg-white/14 text-white" : "text-white/65 hover:bg-white/8 hover:text-white")}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{s.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/admin" className="flex items-center gap-2.5 px-5 py-5" aria-label="Niala — administration">
      <NialaMark size="md" tone="accent" />
      <span className="flex flex-col leading-tight">
        <NialaWordmark size="sm" className="text-white" />
        <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/55">Administration</span>
      </span>
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-[#1c1530] lg:flex">
        {brand}
        {nav}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu du back-office">
          <button className="absolute inset-0 bg-black/50" aria-label="Fermer le menu" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col overflow-y-auto bg-[#1c1530]">
            <button className="absolute right-3 top-4 rounded-lg p-1.5 text-white/70 hover:bg-white/10" aria-label="Fermer le menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
            {brand}
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <button className="rounded-lg p-2 hover:bg-muted lg:hidden" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <Link href="/admin" className="flex items-center gap-2 lg:hidden"><NialaMark size="sm" tone="accent" /><NialaWordmark size="sm" /></Link>
          <div className="hidden items-center gap-2 lg:flex">
            <NialaMark size="sm" tone="accent" />
            <span className="text-sm font-semibold" style={{ fontFamily: "var(--font-museo)" }}>Niala</span>
            <span className="rounded-full bg-[var(--niala-accent)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--niala-accent)]">Back-office</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {showPeriod && <PeriodSelector />}
            <QuickMenu items={quick} />
            <BellMenu bell={bell} />
            <ProfileMenu admin={admin} />
          </div>
        </header>
        <main id="contenu" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6">{children}</main>
        <ProductTour tourId={ADMIN_TOUR_ID} version={1} userKey={admin.id} steps={ADMIN_TOUR} />
      </div>
    </div>
  );
}

// ── Période d'analyse ────────────────────────────────────────────────────────

function PeriodSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const current = (PERIOD_KEYS as readonly string[]).includes(params.get("p") ?? "") ? params.get("p")! : "30d";
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");

  const go = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null) q.delete(k);
      else q.set(k, v);
    }
    q.delete("page");
    start(() => router.push(`${pathname}?${q.toString()}`));
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div data-tour="admin-period" className={cn("flex flex-wrap items-center gap-2", pending && "opacity-60")} role="group" aria-label="Période d'analyse">
      <label className="sr-only" htmlFor="period">Période d'analyse</label>
      <select id="period" value={current} onChange={(e) => (e.target.value === "custom" ? go({ p: "custom" }) : go({ p: e.target.value, from: null, to: null }))} className="h-9 rounded-lg border bg-background px-2.5 text-sm">
        {PERIOD_KEYS.map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
      </select>
      {current === "custom" && (
        <form className="flex flex-wrap items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); if (from && to) go({ p: "custom", from, to }); }}>
          <input type="date" aria-label="Début" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border bg-background px-2 text-sm" required />
          <span className="text-muted-foreground">→</span>
          <input type="date" aria-label="Fin" value={to} max={today} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border bg-background px-2 text-sm" required />
          <button className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">Appliquer</button>
        </form>
      )}
    </div>
  );
}

// ── Menus de la barre supérieure ─────────────────────────────────────────────

function useDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onClick = (e: MouseEvent) => !(e.target as HTMLElement).closest("[data-menu]") && close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close]);
}

function MenuBox({ label, icon, badge, children, align = "right", tour }: { label: string; icon: React.ReactNode; badge?: number; children: React.ReactNode; align?: "left" | "right"; tour?: string }) {
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false));
  return (
    <div className="relative" data-menu>
      <button data-tour={tour} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu" aria-label={label} className="relative flex h-9 items-center gap-1.5 rounded-lg border bg-background px-2.5 text-sm hover:bg-muted">
        {icon}
        {!!badge && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">{badge > 99 ? "99+" : badge}</span>}
      </button>
      {open && <div role="menu" className={cn("absolute z-50 mt-2 w-80 max-w-[90vw] rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl", align === "right" ? "right-0" : "left-0")}>{children}</div>}
    </div>
  );
}

function QuickMenu({ items }: { items: { href: string; label: string }[] }) {
  if (!items.length) return null;
  return (
    <MenuBox tour="admin-quick" label="Actions rapides" icon={<><Zap className="h-4 w-4" aria-hidden /><span className="hidden text-sm sm:inline">Actions rapides</span><ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden /></>}>
      {items.map((i) => <Link key={i.href} role="menuitem" href={i.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-muted">{i.label}</Link>)}
    </MenuBox>
  );
}

function BellMenu({ bell }: { bell: ShellProps["bell"] }) {
  const count = bell.alerts.length + bell.newRequests;
  return (
    <MenuBox tour="admin-bell" label={`Notifications administrateur${count ? ` (${count})` : ""}`} icon={<Bell className="h-4 w-4" aria-hidden />} badge={count}>
      <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">Notifications administrateur</p>
      {!count && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Rien à signaler.</p>}
      {bell.canSeeRequests && bell.newRequests > 0 && (
        <Link role="menuitem" href="/admin/demandes?status=RECEIVED" className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-muted">
          <span>{bell.newRequests} nouvelle{bell.newRequests > 1 ? "s" : ""} demande{bell.newRequests > 1 ? "s" : ""} à examiner</span>
          <Inbox className="h-4 w-4 opacity-60" aria-hidden />
        </Link>
      )}
      {bell.canSeeTech && bell.alerts.map((a) => (
        <Link key={a.id} role="menuitem" href="/admin/performance" className="block rounded-lg px-3 py-2 text-sm hover:bg-muted">
          <span className="flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", a.severity === "CRITICAL" ? "bg-rose-600" : "bg-amber-500")} aria-hidden /><span className="font-medium">{a.title}</span></span>
          {a.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{a.detail}</span>}
        </Link>
      ))}
    </MenuBox>
  );
}

function ProfileMenu({ admin }: { admin: ShellProps["admin"] }) {
  const router = useRouter();
  const logout = async () => {
    try {
      await api.post("/api/admin/auth/logout", {});
      router.replace("/admin/login");
      router.refresh();
    } catch {
      notify({ title: "Déconnexion impossible", description: "Réessayez dans un instant.", variant: "error" });
    }
  };
  return (
    <MenuBox tour="admin-profile" label="Profil administrateur" icon={<><ShieldCheck className="h-4 w-4 text-[var(--niala-accent)]" aria-hidden /><span className="hidden max-w-[140px] truncate text-sm md:inline">{admin.name ?? admin.email}</span><ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden /></>}>
      <div className="px-3 py-2">
        <p className="truncate text-sm font-medium">{admin.name ?? "Administrateur"}</p>
        <p className="truncate text-xs text-muted-foreground">{admin.email}</p>
        <p className="mt-1.5 inline-flex rounded-full bg-[var(--niala-accent)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--niala-accent)]">{admin.roleLabel}</p>
      </div>
      <button role="menuitem" onClick={() => startTour(ADMIN_TOUR_ID)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"><Compass className="h-4 w-4" aria-hidden />Revoir la visite guidée</button>
      <button role="menuitem" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted"><LogOut className="h-4 w-4" aria-hidden />Se déconnecter</button>
    </MenuBox>
  );
}
