import { BookOpen, BookText, Briefcase, ClipboardList, FileCheck2, FlaskConical, GraduationCap, Mic, PenLine, Puzzle, type LucideIcon } from "lucide-react";
import { formatMinutes, parseTime } from "@/server/domain/schedule";

export interface SubjectOption {
  id: string;
  name: string;
  color: string;
  icon?: string | null;
}

export interface OccurrenceDto {
  key: string;
  eventId: string;
  originalDate: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  title: string;
  kind: string;
  subjectId: string | null;
  subject: SubjectOption | null;
  recurrence: "NONE" | "WEEKLY" | "DATES";
  until: string | null;
  dates: string[] | null;
  endDate: string | null;
  allDay: boolean;
  code: string | null;
  sessionType: string | null;
  weekPattern: "ALL" | "A" | "B";
  room: string | null;
  teacher: string | null;
  groupName: string | null;
  description: string | null;
  importId: string | null;
  confidence: string | null;
  overridden: boolean;
}

export interface BreakDto {
  id: string;
  label: string;
  startMinutes: number;
  endMinutes: number;
  weekday: number | null;
}

export interface AgendaData {
  occurrences: OccurrenceDto[];
  subjects: SubjectOption[];
  weekSwap: boolean;
  breaks: BreakDto[];
}

export interface SessionDto {
  id: string;
  taskId: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  done: boolean;
}

export type TaskStatus = "A_COMMENCER" | "EN_COURS" | "EN_ATTENTE" | "TERMINE" | "SOUMIS" | "EN_RETARD" | "ANNULE";

export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  subjectId: string | null;
  subject: SubjectOption | null;
  documentId: string | null;
  exerciseId: string | null;
  parentId: string | null;
  type: keyof typeof TASK_META;
  priority: "BASSE" | "NORMALE" | "HAUTE";
  status: TaskStatus;
  storedStatus: Exclude<TaskStatus, "EN_RETARD">;
  dueDate: string;
  dueMinutes: number | null;
  estimatedMinutes: number | null;
  requiresSubmission: boolean;
  reminderMinutes: number[] | null;
  recurrence: "NONE" | "WEEKLY";
  sessions: SessionDto[];
}

export type Scope = "all" | "occurrence";

export const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Icône et libellé de chaque catégorie : la couleur n'est jamais le seul repère. */
export const TASK_META: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  DEVOIR: { label: "Devoir", icon: PenLine, color: "#f4c95d" },
  TD: { label: "TD", icon: ClipboardList, color: "#b8cbea" },
  TP: { label: "TP", icon: FlaskConical, color: "#b7e4c7" },
  EXERCICE: { label: "Exercice", icon: Puzzle, color: "#e7c6f5" },
  PROJET: { label: "Projet", icon: Briefcase, color: "#f6b8a8" },
  EXPOSE: { label: "Exposé", icon: Mic, color: "#f6b8c8" },
  REVISION: { label: "Révision", icon: BookOpen, color: "#c5e1f5" },
  EXAMEN: { label: "Examen", icon: GraduationCap, color: "#f28b82" },
  LECTURE: { label: "Lecture", icon: BookText, color: "#d9e8b0" },
  AUTRE: { label: "Autre", icon: FileCheck2, color: "#dddddd" },
};

export const STATUS_LABEL: Record<TaskStatus, string> = { A_COMMENCER: "À commencer", EN_COURS: "En cours", EN_ATTENTE: "En attente", TERMINE: "Terminé", SOUMIS: "Soumis", EN_RETARD: "En retard", ANNULE: "Annulé" };
export const PRIORITY_LABEL = { BASSE: "Basse", NORMALE: "Normale", HAUTE: "Haute" };

const FALLBACK_COLORS = ["#f4c95d", "#b8cbea", "#e7c6f5", "#b7e4c7", "#f6b8a8"];

export function colorOf(o: Pick<OccurrenceDto, "subject" | "title">): string {
  if (o.subject?.color) return o.subject.color;
  const hash = [...o.title].reduce((t, c) => (t * 31 + c.charCodeAt(0)) % 997, 7);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export const toTimeInput = (m: number | null) => (m === null ? "" : formatMinutes(m));
export const fromTimeInput = (v: string) => parseTime(v);

/** Date et heure de l'appareil de l'étudiant. */
export function localClock(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, minutes: d.getHours() * 60 + d.getMinutes() };
}

export const formatDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", options);

export const dueLabel = (t: Pick<TaskDto, "dueDate" | "dueMinutes">) => `${formatDay(t.dueDate, { weekday: "long", day: "numeric", month: "long" })}${t.dueMinutes !== null ? ` à ${formatMinutes(t.dueMinutes)}` : ""}`;

/** Lien qui ouvre la création d'une tâche préremplie dans l'agenda. */
export function planHref(p: { title?: string; type?: string; subjectId?: string | null; documentId?: string | null; exerciseId?: string | null }) {
  const q = new URLSearchParams({ action: "task" });
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, k === "title" ? v.slice(0, 200) : v);
  return `/agenda?${q}`;
}

export const courseHint = (o: OccurrenceDto) => [o.title, o.sessionType, `${formatMinutes(o.startMinutes)} – ${formatMinutes(o.endMinutes)}`, o.room ? `Salle ${o.room}` : null, o.teacher, o.code].filter(Boolean).join(" · ");
export const taskHint = (t: TaskDto) => `${TASK_META[t.type]?.label ?? "Tâche"} · ${t.title} · Date limite : ${dueLabel(t)} · ${STATUS_LABEL[t.status]}`;
