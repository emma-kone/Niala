import { formatMinutes, parseTime } from "@/server/domain/schedule";

export interface SubjectOption {
  id: string;
  name: string;
  color: string;
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
  recurrence: "NONE" | "WEEKLY";
  until: string | null;
  weekPattern: "ALL" | "A" | "B";
  room: string | null;
  teacher: string | null;
  groupName: string | null;
  description: string | null;
  importId: string | null;
  confidence: string | null;
  overridden: boolean;
}

export interface AgendaData {
  occurrences: OccurrenceDto[];
  subjects: SubjectOption[];
  weekSwap: boolean;
}

export type Scope = "all" | "occurrence";

export const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

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
