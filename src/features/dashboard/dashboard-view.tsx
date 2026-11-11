"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, BookOpen, CalendarDays, CalendarPlus, Check, ChevronDown, ClipboardList, Coffee, FileText, FileUp, Lightbulb, X } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SubjectIcon } from "@/components/subject-icon";
import { useAppStore } from "@/store/app-store";
import { TASK_META, dueLabel, formatDay, localClock, planHref } from "@/features/agenda/types";
import { recommendationHref, type DashboardData, type DashboardTask, type Recommendation } from "@/features/progress/types";
import { buildDayView, referenceDate, type DayView } from "@/server/domain/dashboard";
import { classifyOccurrence, formatMinutes, weekday } from "@/server/domain/schedule";

const errText = (e: unknown, fb: string) => (e instanceof Error ? e.message : fb);

type RecentDocument = DashboardData["recentDocuments"][number];

function ago(d: string) {
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  return days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
}

const position = (d: RecentDocument) => (d.lastPage && d.pageCount ? `Page ${d.lastPage} sur ${d.pageCount}` : d.lastPage ? `Page ${d.lastPage}` : null);

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

function HeroCta({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mt-4 inline-flex shrink-0 items-center gap-3 rounded-full bg-[var(--dash-cta)] py-1.5 pl-1.5 pr-5 text-sm font-medium text-[var(--dash-cta-foreground)] transition-transform hover:-translate-y-0.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--dash-cta-foreground)] text-[var(--dash-cta)]"><ArrowRight className="h-4 w-4" aria-hidden /></span>
      {label}
    </Link>
  );
}

/** S'adapte à la hauteur disponible : le bouton de reprise reste toujours visible dans la grande carte. */
const HERO_TITLE = "line-clamp-2 break-words text-3xl font-bold leading-[1.1] tracking-tight lg:text-[clamp(1.6rem,min(3.4vw,5.2vh),3rem)]";

/** Dernier cours ouvert : matière, titre, position de lecture et reprise à la page enregistrée. */
function ResumeContent({ doc }: { doc: RecentDocument }) {
  const where = position(doc);
  const ratio = doc.lastPage && doc.pageCount ? Math.min(1, doc.lastPage / doc.pageCount) : null;
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[.16em] text-dash-panel-foreground/60">À reprendre</p>
      <p className="mt-2 flex items-center gap-2 text-sm font-medium"><SubjectIcon icon={doc.subjectIcon} name={doc.subjectName} color={doc.subjectColor} surface="pastel" /> <span className="truncate">{doc.subjectName}</span></p>
      <h1 className={cn("mt-1.5", HERO_TITLE)}>{doc.name}</h1>
      <p className="mt-2 max-w-md text-sm text-dash-panel-foreground/70">{where ? `${where} · ouvert ${ago(doc.lastOpenedAt)}` : `Ouvert ${ago(doc.lastOpenedAt)}`}</p>
      {ratio !== null && (
        <div className="mt-2 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-dash-panel-foreground/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label="Progression de lecture">
          <div className="h-full rounded-full bg-[var(--dash-cta)]" style={{ width: `${Math.max(3, ratio * 100)}%` }} />
        </div>
      )}
      <HeroCta href={doc.href} label="Reprendre" />
    </>
  );
}

/** Haut du grand bloc en L : toujours le dernier cours consulté, ou un accueil tant qu'aucun cours n'a été ouvert. */
function Hero({ data, name }: { data: DashboardData; name: string }) {
  const doc = data.recentDocuments[0];
  const h = data.highlight;
  const rec = h.kind === "recommendation" ? data.next : null;
  const href = h.href ?? (rec ? recommendationHref(rec) : null);
  return (
    <section aria-label="Dernier cours consulté" className="relative z-[1] flex min-h-[320px] flex-col justify-between overflow-hidden rounded-[32px] bg-dash-panel p-6 text-dash-panel-foreground sm:p-8 lg:col-span-2 lg:min-h-0 lg:rounded-[60px] lg:px-10 lg:py-8 xl:px-12">
      <svg aria-hidden viewBox="0 0 400 400" className="pointer-events-none absolute -right-16 -top-16 h-[220px] w-[220px] xl:h-[380px] xl:w-[380px]">
        <defs><linearGradient id="niala-glow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#e7c6f5" /><stop offset=".55" stopColor="#f4c95d" /><stop offset="1" stopColor="#f26b3a" /></linearGradient></defs>
        <circle cx="210" cy="190" r="118" fill="url(#niala-glow)" />
        {[150, 182].map((r) => <circle key={r} cx="210" cy="190" r={r} fill="none" stroke="currentColor" strokeOpacity=".12" />)}
      </svg>
      <p className="relative text-lg font-medium">Bonjour{name ? ` ${name}` : ""}</p>
      <div className="relative mt-4 lg:max-w-[62%]">
        {doc ? (
          <ResumeContent doc={doc} />
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-dash-panel-foreground/60">{h.eyebrow}</p>
            <h1 className={cn("mt-2", HERO_TITLE)}>{h.title}</h1>
            <p className="mt-3 line-clamp-3 max-w-md text-sm text-dash-panel-foreground/70 xl:text-base">{h.detail}</p>
            {href && <HeroCta href={href} label={h.cta ?? "Ouvrir"} />}
          </>
        )}
      </div>
    </section>
  );
}

const DAY_WORD = (v: DayView) => (v.isTomorrow ? "demain" : "aujourd'hui");

function daySummary(v: DayView) {
  if (v.state === "no_schedule") return "Emploi du temps à importer";
  if (v.state === "unavailable") return "Agenda momentanément indisponible";
  if (v.state === "none") return `Aucun cours ${DAY_WORD(v)}`;
  if (v.state === "finished") return "Cours terminés pour aujourd'hui";
  return `${v.courses.length} cours ${DAY_WORD(v)}`;
}

/** Branche basse du L : la date réelle reste affichée, même quand le résumé présente déjà le lendemain. */
function DayPanel({ data, view }: { data: DashboardData; view: DayView }) {
  const day = new Date(`${view.date}T12:00:00`);
  return (
    // Sur grand écran, la rangée a une hauteur imposée par la grille : marges et chiffre suivent la hauteur de l'écran pour ne jamais déborder.
    <section aria-label="La journée en bref" className="relative z-[1] flex min-h-0 min-w-0 flex-col justify-between gap-6 rounded-[32px] bg-dash-panel p-6 text-dash-panel-foreground sm:p-8 lg:gap-3 lg:rounded-none lg:bg-transparent lg:px-8 lg:pb-[clamp(1rem,3vh,2.5rem)] lg:pt-[clamp(1.25rem,4vh,4rem)] xl:px-10">
      <div className="min-w-0">
        <p className="tnum text-6xl font-bold leading-none tracking-tight lg:text-[clamp(2.75rem,9vh,5rem)]">{day.getDate()}</p>
        <p className="mt-1 truncate text-lg font-medium capitalize">{day.toLocaleDateString("fr-FR", { weekday: "long" })}</p>
        <p className="truncate text-sm capitalize text-dash-panel-foreground/60">{day.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</p>
      </div>
      <div className="flex min-w-0 items-end justify-between gap-3">
        <p className="min-w-0 text-sm font-medium">{daySummary(view)}</p>
        {data.overallMastery !== null && <ProgressRing value={data.overallMastery} />}
      </div>
    </section>
  );
}

/**
 * Trois cartes qui se chevauchent, de haut en bas dans l'ordre de consultation : 01 en haut, puis 02, puis 03 au premier plan.
 * La dernière carte présente occupe la place restante : la pile ne contient jamais que de vrais documents.
 */
function stackStyle(index: number, count: number): React.CSSProperties {
  const top = index * 25;
  return { "--stack-top": `${top}%`, "--stack-height": index === count - 1 ? `${100 - top}%` : "50%", "--stack-z": (index + 1) * 10 } as React.CSSProperties;
}

function RecentDocuments({ docs }: { docs: DashboardData["recentDocuments"] }) {
  if (docs.length === 0) {
    return (
      <section aria-label="Derniers cours consultés" className="h-full">
        <Link href={routes.subjects} className="flex h-full min-h-[130px] items-center gap-3 rounded-[25px] bg-card p-5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden /> Ouvrez un cours pour le retrouver ici
        </Link>
      </section>
    );
  }
  return (
    <section aria-label="Derniers cours consultés" className="relative grid h-full gap-3 sm:grid-cols-3 lg:block">
      {docs.map((d, i) => {
        const last = i === docs.length - 1;
        const where = position(d);
        return (
          <Link
            key={d.id}
            href={d.href}
            data-rank={i + 1}
            className={cn("group flex min-h-[130px] flex-col justify-between rounded-[25px] p-5 text-on-pastel shadow-[0_0_0_3px_var(--dash-surface)] transition-transform hover:!z-40 lg:absolute lg:inset-x-0 lg:top-[var(--stack-top)] lg:z-[var(--stack-z)] lg:h-[var(--stack-height)] lg:min-h-0", !last && "lg:justify-start")}
            style={{ ...stackStyle(i, docs.length), background: `color-mix(in srgb, ${d.subjectColor} 40%, var(--stack-base))` }}
          >
            <span className="flex items-center justify-between text-xs font-medium">
              <span className="tnum rounded-full bg-white/80 px-2 py-0.5">0{i + 1}</span>
              <ArrowUpRight className="h-4 w-4 opacity-50 transition-opacity group-hover:opacity-100" aria-hidden />
            </span>
            <span className={cn(!last && "lg:mt-2")}>
              <span className="flex items-center gap-1.5 truncate text-xs opacity-80"><SubjectIcon icon={d.subjectIcon} name={d.subjectName} color={d.subjectColor} size="xs" surface="pastel" /> {d.subjectName}</span>
              <span className="line-clamp-2 font-semibold leading-tight">{d.name}</span>
              <span className="mt-0.5 flex items-center gap-1 text-[11px] opacity-70"><FileText className="h-3 w-3" aria-hidden />{where ?? d.type.toUpperCase()} · {ago(d.lastOpenedAt)}</span>
            </span>
          </Link>
        );
      })}
    </section>
  );
}

function Suggestions({ data, onDismiss }: { data: DashboardData; onDismiss: (r: Recommendation) => void }) {
  const byId = new Map(data.recommendations.map((r) => [r.id, r]));
  return (
    <section aria-label="Suggestions" className="overflow-y-auto rounded-[25px] bg-card p-5 sm:p-6 lg:mt-[42px]">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><Lightbulb className="h-4 w-4" aria-hidden /> Suggestions</h2>
      {data.suggestions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Rien à proposer pour l&apos;instant : les suggestions viennent de vos résultats, de vos activités et de votre agenda.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.suggestions.map((s) => {
            const rec = s.recommendationId ? byId.get(s.recommendationId) : undefined;
            // Une suggestion mène toujours à une page complète : à défaut de cible précise, le détail de la progression.
            const href = s.href ?? (rec ? (recommendationHref(rec) ?? routes.progress) : null);
            const body = (
              <>
                <span className="block font-medium leading-tight">{s.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.text}</span>
              </>
            );
            return (
              <li key={s.id} className="group relative rounded-2xl bg-muted/50 transition-colors hover:bg-muted">
                {href ? <Link href={href} className={cn("block p-3", rec ? "pr-16" : "pr-9")}>{body}</Link> : <div className={cn("p-3", rec ? "pr-16" : "pr-9")}>{body}</div>}
                {rec && <Link href={planHref({ title: s.title, type: "REVISION" })} aria-label={`Planifier : ${s.title}`} data-hint="Planifier cette recommandation" className="absolute right-8 top-2 rounded-full p-1 text-muted-foreground hover:bg-background"><CalendarPlus className="h-3.5 w-3.5" aria-hidden /></Link>}
                {rec && <button type="button" aria-label={`Écarter : ${s.title}`} onClick={() => onDismiss(rec)} className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground hover:bg-background"><X className="h-3.5 w-3.5" aria-hidden /></button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const nextLabel = (c: DashboardData["today"][number]) => `${c.subjectName ?? c.title}, ${formatDay(c.date, { weekday: "long", day: "numeric", month: "long" })} à ${formatMinutes(c.startMinutes)}`;

/** Message d'un état sans cours à afficher. Jamais présenté quand la journée en contient. */
function DayNotice({ view }: { view: DayView<DashboardData["today"][number]> }) {
  if (view.state === "no_schedule") {
    return (
      <div className="mt-3 rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
        Votre emploi du temps n&apos;a pas encore été importé.
        <Link href={`${routes.agenda}?action=import`} className="mt-2 flex items-center gap-1.5 font-medium text-foreground hover:underline"><FileUp className="h-3.5 w-3.5" aria-hidden /> Importer mon emploi du temps</Link>
      </div>
    );
  }
  if (view.state === "unavailable") return <p role="status" className="mt-3 rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">L&apos;agenda n&apos;a pas pu être chargé : vos cours n&apos;ont pas disparu, réessayez dans un instant.</p>;
  return (
    <div className="mt-3 rounded-2xl bg-muted/50 p-4 text-sm text-muted-foreground">
      {view.state === "finished" ? "Tous les cours de la journée sont terminés." : `Aucun cours prévu ${DAY_WORD(view)}.`}
      <p className="mt-1 text-foreground">{view.next ? <><span className="font-medium">Prochain cours :</span> {nextLabel(view.next)}</> : "Plus aucun cours prévu pour le moment."}</p>
    </div>
  );
}

const COLLAPSED_ROWS = 4;

type ScheduleRow =
  | { type: "course"; key: string; startMinutes: number; endMinutes: number; phase: "done" | "current" | "upcoming"; course: DayView<DashboardData["today"][number]>["courses"][number] }
  | { type: "session"; key: string; startMinutes: number; endMinutes: number; phase: "done" | "current" | "upcoming"; title: string }
  | { type: "break"; key: string; startMinutes: number; endMinutes: number; phase: "done" | "current" | "upcoming"; title: string };

/** Cours de la journée de référence : chronologie, état de chaque séance, et consultation repliée quand ils sont nombreux. */
function MiniSchedule({ data, view, now }: { data: DashboardData; view: DayView<DashboardData["today"][number]>; now: { date: string; minutes: number } }) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo<ScheduleRow[]>(() => {
    const phase = (s: { startMinutes: number; endMinutes: number }) => ({ past: "done", current: "current", upcoming: "upcoming" } as const)[classifyOccurrence({ ...s, date: view.reference }, now.date, now.minutes)];
    const { courses } = view;
    const sessions = data.academic.sessions.filter((s) => s.date === view.reference);
    const first = courses[0]?.startMinutes ?? 1440;
    const last = Math.max(0, ...courses.map((c) => c.endMinutes));
    const breaks = data.breaks.filter((b) => (b.weekday === null || b.weekday === weekday(view.reference)) && b.startMinutes >= first && b.endMinutes <= last && !courses.some((c) => c.startMinutes < b.endMinutes && c.endMinutes > b.startMinutes));
    return [
      ...courses.map((c): ScheduleRow => ({ type: "course", key: c.key, startMinutes: c.startMinutes, endMinutes: c.endMinutes, phase: c.phase, course: c })),
      ...sessions.map((s): ScheduleRow => ({ type: "session", key: `s${s.id}`, startMinutes: s.startMinutes, endMinutes: s.endMinutes, phase: phase(s), title: s.title })),
      ...breaks.map((b): ScheduleRow => ({ type: "break", key: `b${b.startMinutes}`, startMinutes: b.startMinutes, endMinutes: b.endMinutes, phase: phase(b), title: b.label })),
    ].sort((a, b) => a.startMinutes - b.startMinutes);
  }, [view, data.breaks, data.academic.sessions, now.date, now.minutes]);

  // Replié : on garde la partie utile de la journée, à partir de ce qui reste à venir.
  const active = rows.findIndex((r) => r.phase !== "done");
  const start = active === -1 ? Math.max(0, rows.length - COLLAPSED_ROWS) : Math.max(0, Math.min(active, rows.length - COLLAPSED_ROWS));
  const visible = expanded || rows.length <= COLLAPSED_ROWS ? rows : rows.slice(start, start + COLLAPSED_ROWS);
  const nextKey = rows.find((r) => r.type === "course" && r.phase === "upcoming")?.key;
  const hasNotice = view.state !== "active";

  return (
    <section aria-label={`Emploi du temps : ${view.label}`} className="relative z-[1] overflow-y-auto rounded-[32px] bg-card p-6 lg:ml-[19px] lg:mt-[17px] lg:rounded-[50px] lg:p-8">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold">
          <CalendarDays className="h-4 w-4 self-center" aria-hidden /> {view.label}
          <span className="hidden text-xs font-normal capitalize text-muted-foreground xl:inline">{formatDay(view.reference, { weekday: "long", day: "numeric", month: "short" })}</span>
        </h2>
        <Link href={routes.agenda} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium hover:underline">Voir l&apos;agenda <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </div>
      {rows.length > 0 && (
        <ol className="mt-3 space-y-1.5">
          {visible.map((x) => {
            const past = x.phase === "done";
            const span = `${formatMinutes(x.startMinutes)} – ${formatMinutes(x.endMinutes)}`;
            if (x.type === "break") {
              return (
                <li key={x.key} className={cn("flex items-center gap-3 px-3 py-1 text-xs text-muted-foreground", past && "opacity-50")}>
                  <span className="tnum w-24 shrink-0">{span}</span>
                  <Coffee className="h-3 w-3" aria-hidden /> {x.title}
                </li>
              );
            }
            if (x.type === "session") {
              return (
                <li key={x.key} className={cn("flex items-center gap-3 rounded-2xl border border-dashed border-[var(--niala-accent)] px-3 py-1.5 text-sm", past && "opacity-50")}>
                  <span className="tnum w-24 shrink-0 text-xs opacity-75">{span}</span>
                  <span className="min-w-0 flex-1 truncate">Travail : {x.title}</span>
                </li>
              );
            }
            const c = x.course;
            const current = x.phase === "current";
            return (
              <li key={x.key} data-phase={x.phase} className={cn("relative flex items-center gap-3 rounded-2xl px-3 py-2 text-sm", current ? "bg-foreground text-background" : "bg-muted/50", past && "opacity-55")}>
                {current && <span aria-hidden className="niala-pointer-right absolute -left-1 top-1/2 -translate-y-1/2" />}
                <span className={cn("shrink-0 rounded-lg", current && "bg-background")}><SubjectIcon icon={c.subjectIcon} name={c.subjectName ?? c.title} color={c.subjectColor ?? "#8b5cf6"} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.subjectName ?? c.title}</span>
                  <span className="tnum block truncate text-xs opacity-75">{span}{c.teacher ? ` · ${c.teacher}` : ""}{c.room ? ` · ${c.room}` : ""}</span>
                </span>
                {current && <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent-mint)]" aria-hidden />En cours</span>}
                {past && <span className="flex shrink-0 items-center gap-1 text-[11px]"><Check className="h-3 w-3" aria-hidden />Terminé</span>}
                {x.phase === "upcoming" && <span className={cn("shrink-0 rounded-full px-2 py-px text-[11px] font-medium", x.key === nextKey ? "bg-background" : "text-muted-foreground")}>{x.key === nextKey ? "Prochain" : "À venir"}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {rows.length > COLLAPSED_ROWS && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="mt-1.5 flex w-full items-center justify-center gap-1 rounded-xl py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden /> {expanded ? "Réduire" : `Tout afficher (${rows.length})`}
        </button>
      )}
      {hasNotice && <DayNotice view={view} />}
      <Deadlines late={data.academic.late} upcoming={data.academic.upcoming} />
    </section>
  );
}

/** Retards d'abord, puis prochaines tâches : quatre lignes au plus, le reste est dans l'agenda. */
function Deadlines({ late, upcoming }: { late: DashboardTask[]; upcoming: DashboardTask[] }) {
  const list = [...late, ...upcoming].slice(0, 4);
  if (!list.length) return null;
  return (
    <div className="mt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList className="h-3.5 w-3.5" aria-hidden /> Tâches{late.length > 0 && <span className="rounded-full bg-destructive px-2 py-px text-[11px] font-medium text-white">{late.length} en retard</span>}</h3>
      <ul className="mt-1.5 space-y-1">
        {list.map((t) => {
          const meta = TASK_META[t.type] ?? TASK_META.AUTRE;
          const Icon = meta.icon;
          return (
            <li key={t.id}>
              <Link href={`${routes.agenda}?section=taches`} data-hint={`${meta.label} · ${t.title} · ${dueLabel(t)}`} data-hint-action="Consulter la tâche" className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-1.5 text-sm hover:bg-muted">
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">{t.title}{t.priority === "HAUTE" ? " · prioritaire" : ""}</span>
                <span className={cn("shrink-0 text-xs", t.status === "EN_RETARD" ? "font-medium text-destructive" : "text-muted-foreground")}>{new Date(`${t.dueDate}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** L'horloge avance toutes les 15 s : la bascule de 19 h et le changement de jour n'attendent pas un rechargement. */
const CLOCK_TICK_MS = 15_000;
const REFRESH_MS = 5 * 60_000;

export default function DashboardView() {
  const user = useAppStore((s) => s.user);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => localClock());
  const query = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => {
      const c = localClock();
      return api.get<DashboardData>(`/api/dashboard?date=${c.date}&minutes=${c.minutes}`);
    },
    staleTime: 20_000,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true, // retour sur l'onglet : classement et journée sont remis à jour
  });
  const data = query.data ?? null;
  const error = actionError ?? (query.error ? errText(query.error, "Chargement impossible.") : null);
  const { refetch } = query;
  const load = useCallback(() => {
    setActionError(null);
    return refetch();
  }, [refetch]);

  useEffect(() => {
    const tick = setInterval(() => setClock((prev) => {
      const c = localClock();
      return prev.date === c.date && prev.minutes === c.minutes ? prev : c;
    }), CLOCK_TICK_MS);
    return () => clearInterval(tick);
  }, [load]);

  // Nouvelle journée ou bascule de 19 h : les données du serveur (tâches, suggestions) suivent.
  const reference = referenceDate(clock.date, clock.minutes);
  const previousReference = useRef(reference);
  useEffect(() => {
    if (previousReference.current === reference) return;
    previousReference.current = reference;
    void load();
  }, [reference, load]);

  const view = useMemo(() => (data ? buildDayView({ date: clock.date, nowMinutes: clock.minutes, courses: data.today, schedule: data.schedule }) : null), [data, clock]);

  async function dismiss(r: Recommendation) {
    try {
      await api.patch(`/api/recommendations/${r.id}`, { status: "DISMISSED" });
      void load();
    } catch (e) {
      setActionError(errText(e, "Action impossible."));
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
  if (!data || !view) {
    return (
      <div className="mx-auto grid w-full max-w-[1500px] gap-4 p-4 lg:grid-cols-[971fr_400fr]" aria-busy>
        <Skeleton className="h-[640px] rounded-[60px]" />
        <Skeleton className="h-[640px] rounded-[25px]" />
      </div>
    );
  }

  const name = user?.name?.trim().split(/\s+/)[0] ?? "";
  return (
    <div className="mx-auto w-full max-w-[1500px] p-3 sm:p-4">
      {user?.profileComplete === false && (
        <Link href={routes.profile} className="mb-3 flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-sm transition-colors hover:bg-muted/40">
          <span><span className="font-medium">Complétez votre profil</span><span className="text-muted-foreground"> pour des exercices adaptés à votre niveau.</span></span>
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      )}
      {/* Maquette Figma : bloc en L à gauche, emploi du temps dans son encoche, cartes empilées et suggestions à droite. */}
      <div className="grid gap-4 lg:h-[max(620px,calc(100dvh-3.5rem))] lg:grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(0,971fr)_minmax(260px,400fr)] lg:gap-x-[clamp(16px,2.7vw,39px)] lg:gap-y-0">
        <div className="relative grid gap-4 lg:grid-cols-[376fr_595fr] lg:grid-rows-[minmax(0,540fr)_minmax(0,451fr)] lg:gap-0">
          <div aria-hidden className="absolute inset-y-0 left-0 hidden w-[38.72%] rounded-[60px] bg-dash-panel lg:block" />
          <div aria-hidden className="niala-l-fillet absolute left-[calc(38.72%-1px)] top-[calc(54.49%-1px)] hidden h-[61px] w-[61px] lg:block" />
          <Hero data={data} name={name} />
          <DayPanel data={data} view={view} />
          <MiniSchedule data={data} view={view} now={clock} />
        </div>
        <div className="grid gap-4 lg:grid-rows-[minmax(0,540fr)_minmax(0,451fr)] lg:gap-0">
          <RecentDocuments docs={data.recentDocuments} />
          <Suggestions data={data} onDismiss={(r) => void dismiss(r)} />
        </div>
      </div>
      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
