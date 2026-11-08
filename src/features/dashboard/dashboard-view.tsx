"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Coffee, FileText, FileUp, Lightbulb, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { localClock } from "@/features/agenda/types";
import { recommendationHref, type DashboardData, type Recommendation } from "@/features/progress/types";
import { BREAKS, formatMinutes } from "@/server/domain/schedule";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);
const panel = "rounded-[28px] bg-card";

function ago(d: string) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
}

/** Progression générale en anneau : affichée seulement si elle est mesurée. */
function ProgressRing({ value }: { value: number }) {
  const c = 2 * Math.PI * 26;
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`Maîtrise estimée : ${Math.round(value * 100)} %`}>
      <svg viewBox="0 0 60 60" className="-rotate-90">
        <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="5" />
        <circle cx="30" cy="30" r="26" fill="none" stroke="var(--accent-sun)" strokeWidth="5" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value)} />
      </svg>
      <span className="tnum absolute inset-0 flex items-center justify-center text-sm font-semibold">{Math.round(value * 100)}%</span>
    </div>
  );
}

function Hero({ data, name, date }: { data: DashboardData; name: string; date: string }) {
  const h = data.highlight;
  const rec = h.kind === "recommendation" ? data.next : null;
  const href = h.href ?? (rec ? recommendationHref(rec) : null);
  const label = new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <section aria-label="L'essentiel" className="relative flex min-h-[340px] flex-col justify-between overflow-hidden rounded-[32px] bg-[#101012] p-6 text-white sm:p-8 lg:min-h-[420px]">
      <svg aria-hidden viewBox="0 0 400 400" className="pointer-events-none absolute -right-20 -top-20 h-[240px] w-[240px] opacity-90 xl:-right-24 xl:-top-16 xl:h-[520px] xl:w-[520px]">
        <defs><linearGradient id="niala-glow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e7c6f5" /><stop offset=".55" stopColor="#f4c95d" /><stop offset="1" stopColor="#f26b3a" /></linearGradient></defs>
        <circle cx="210" cy="190" r="118" fill="url(#niala-glow)" />
        {[150, 182, 214].map((r) => <circle key={r} cx="210" cy="190" r={r} fill="none" stroke="#fff" strokeOpacity=".14" />)}
      </svg>
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-medium">Bonjour{name ? ` ${name}` : ""}</p>
          <p className="text-sm capitalize text-white/60">{label}</p>
        </div>
        {data.overallMastery !== null && <ProgressRing value={data.overallMastery} />}
      </div>
      <div className="relative mt-10 max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-white/60">{h.eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold leading-[1.1] tracking-tight sm:text-5xl">{h.title}</h1>
        <p className="mt-3 max-w-md text-sm text-white/70 sm:text-base">{h.detail}</p>
        {href && (
          <Link href={href} className="mt-6 inline-flex items-center gap-3 rounded-full bg-white py-1.5 pl-1.5 pr-5 text-sm font-medium text-black transition-transform hover:-translate-y-0.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black text-white"><ArrowRight className="h-4 w-4" aria-hidden /></span>
            {h.cta ?? "Ouvrir"}
          </Link>
        )}
      </div>
    </section>
  );
}

function RecentDocuments({ docs }: { docs: DashboardData["recentDocuments"] }) {
  if (docs.length === 0) {
    return (
      <section aria-label="Derniers cours consultés" className={cn(panel, "flex h-full min-h-[240px] flex-col items-center justify-center border p-6 text-center")}>
        <BookOpen className="h-7 w-7 text-muted-foreground" aria-hidden />
        <p className="mt-2 font-medium">Aucun cours consulté</p>
        <p className="mt-1 text-sm text-muted-foreground">Ouvrez ou importez un cours : vos trois derniers apparaîtront ici.</p>
        <Button asChild variant="outline" size="sm" className="mt-4 rounded-full"><Link href={routes.subjects}>Mes matières</Link></Button>
      </section>
    );
  }
  return (
    <section aria-label="Derniers cours consultés" className="grid h-full gap-3 sm:grid-cols-3 lg:grid-cols-1 lg:grid-rows-3">
      {docs.map((d, i) => (
        <Link key={d.id} href={d.href} className="group relative flex min-h-[120px] flex-col justify-between overflow-hidden rounded-[24px] p-4 transition-transform hover:-translate-y-0.5" style={{ background: `color-mix(in srgb, ${d.subjectColor} 28%, var(--card))` }}>
          {i < docs.length - 1 && <span aria-hidden className="niala-connector hidden lg:block" />}
          <span className="flex items-center justify-between text-xs font-medium">
            <span className="tnum rounded-full bg-background/80 px-2 py-0.5">0{i + 1}</span>
            <ArrowUpRight className="h-4 w-4 opacity-50 transition-opacity group-hover:opacity-100" aria-hidden />
          </span>
          <span>
            <span className="block truncate text-xs opacity-70">{d.subjectName}</span>
            <span className="line-clamp-2 font-semibold leading-tight">{d.name}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[11px] opacity-70"><FileText className="h-3 w-3" aria-hidden />{d.lastPage && d.pageCount ? `Page ${d.lastPage} sur ${d.pageCount}` : d.type.toUpperCase()} · {ago(d.lastOpenedAt)}</span>
          </span>
        </Link>
      ))}
    </section>
  );
}

function Suggestions({ data, onDismiss }: { data: DashboardData; onDismiss: (r: Recommendation) => void }) {
  const byId = new Map(data.recommendations.map((r) => [r.id, r]));
  return (
    <section aria-label="Suggestions" className={cn(panel, "border p-5 sm:p-6")}>
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Lightbulb className="h-4 w-4" aria-hidden /> Suggestions</h2>
      {data.suggestions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Rien à proposer pour l&apos;instant : les suggestions viennent de vos résultats, de vos activités et de votre agenda.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.suggestions.map((s) => {
            const rec = s.recommendationId ? byId.get(s.recommendationId) : undefined;
            const href = s.href ?? (rec ? recommendationHref(rec) : null);
            const body = (
              <>
                <span className="block font-medium leading-tight">{s.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.text}</span>
              </>
            );
            return (
              <li key={s.id} className="group relative rounded-2xl bg-muted/50 transition-colors hover:bg-muted">
                {href ? <Link href={href} className="block p-3 pr-9">{body}</Link> : <div className="p-3 pr-9">{body}</div>}
                {rec && <button type="button" aria-label={`Écarter : ${s.title}`} onClick={() => onDismiss(rec)} className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-background"><X className="h-3.5 w-3.5" aria-hidden /></button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function MiniSchedule({ data, date, now }: { data: DashboardData; date: string; now: number }) {
  const items = useMemo(() => {
    const courses = data.today.filter((c) => c.date === date);
    if (!courses.length) return [];
    const first = courses[0].startMinutes;
    const last = Math.max(...courses.map((c) => c.endMinutes));
    const breaks = BREAKS.filter((b) => b.start >= first && b.end <= last && !courses.some((c) => c.startMinutes < b.end && c.endMinutes > b.start));
    return [...courses.map((c) => ({ type: "course" as const, ...c })), ...breaks.map((b) => ({ type: "break" as const, key: `b${b.start}`, title: b.label, startMinutes: b.start, endMinutes: b.end }))].sort((a, b) => a.startMinutes - b.startMinutes);
  }, [data.today, date]);
  const nextKey = items.find((x) => x.type === "course" && x.startMinutes > now)?.key;
  return (
    <section aria-label="Emploi du temps du jour" className={cn(panel, "border p-5 sm:p-6")}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarDays className="h-4 w-4" aria-hidden /> Aujourd&apos;hui</h2>
        <Link href={routes.agenda} className="inline-flex items-center gap-1 text-sm font-medium hover:underline">Voir l&apos;agenda <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </div>
      {items.length === 0 ? (
        <div className="mt-3 rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
          Aucun cours aujourd&apos;hui.
          <Link href={`${routes.agenda}?action=import`} className="mt-2 flex items-center gap-1.5 font-medium text-foreground hover:underline"><FileUp className="h-3.5 w-3.5" aria-hidden /> Importer mon emploi du temps</Link>
        </div>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {items.map((x) => {
            const current = x.type === "course" && x.startMinutes <= now && now < x.endMinutes;
            const past = x.endMinutes <= now;
            if (x.type === "break") {
              return (
                <li key={x.key} className={cn("flex items-center gap-3 px-3 py-1 text-xs text-muted-foreground", past && "opacity-50")}>
                  <span className="tnum w-24 shrink-0">{formatMinutes(x.startMinutes)} – {formatMinutes(x.endMinutes)}</span>
                  <Coffee className="h-3 w-3" aria-hidden /> {x.title}
                </li>
              );
            }
            return (
              <li key={x.key} className={cn("relative flex items-center gap-3 rounded-2xl px-3 py-2 text-sm", current ? "bg-foreground text-background" : "bg-muted/50", past && "opacity-50")}>
                {current && <span aria-hidden className="niala-pointer-right absolute -left-1 top-1/2 -translate-y-1/2" />}
                <span className="tnum w-24 shrink-0 text-xs opacity-75">{formatMinutes(x.startMinutes)} – {formatMinutes(x.endMinutes)}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{x.title}{x.room ? <span className="font-normal opacity-70"> · {x.room}</span> : null}</span>
                {current && <span className="text-[11px] font-medium">En cours</span>}
                {x.key === nextKey && !current && <span className="rounded-full bg-background px-2 py-px text-[11px] font-medium">Prochain</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default function DashboardView() {
  const user = useAppStore((s) => s.user);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(localClock);

  const load = useCallback(async () => {
    const c = localClock();
    try {
      setData(await api.get<DashboardData>(`/api/dashboard?date=${c.date}&minutes=${c.minutes}`));
      setClock(c);
      setError(null);
    } catch (e) {
      setError(errText(e, "Chargement impossible."));
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function dismiss(r: Recommendation) {
    try {
      await api.patch(`/api/recommendations/${r.id}`, { status: "DISMISSED" });
      void load();
    } catch (e) {
      setError(errText(e, "Action impossible."));
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="typo-h2">Tableau de bord indisponible</h1>
        <p className="typo-subtitle mt-2">{error}</p>
        <Button className="mt-6" variant="outline" onClick={() => void load()}>Réessayer</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto grid w-full max-w-[1400px] gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px]" aria-busy>
        <Skeleton className="h-[420px] rounded-[32px]" />
        <Skeleton className="h-[420px] rounded-[28px]" />
        <Skeleton className="h-56 rounded-[28px] lg:col-span-2" />
      </div>
    );
  }

  const name = user?.name?.trim().split(/\s+/)[0] ?? "";
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 px-4 py-5 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Hero data={data} name={name} date={clock.date} />
        <RecentDocuments docs={data.recentDocuments} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Suggestions data={data} onDismiss={(r) => void dismiss(r)} />
        <MiniSchedule data={data} date={clock.date} now={clock.minutes} />
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
