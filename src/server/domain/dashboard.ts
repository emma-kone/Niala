// Tableau de bord : choix de l'information principale et des suggestions. Règles pures, à partir de données réelles uniquement.

import { formatMinutes } from "./schedule";

export interface CourseToday {
  key: string;
  date: string;
  title: string;
  startMinutes: number;
  endMinutes: number;
  room: string | null;
  subjectId: string | null;
  subjectName: string | null;
}

export interface Highlight {
  kind: "course_now" | "course_soon" | "resume" | "recommendation" | "course_later" | "progress" | "start";
  eyebrow: string;
  title: string;
  detail: string;
  href: string | null;
  cta: string | null;
}

export interface HighlightInput {
  date: string;
  nowMinutes: number;
  today: CourseToday[];
  resume: { title: string; href: string | null } | null;
  recommendation: { id: string; title: string; text: string } | null;
  mastery: number | null;
  hasSubjects: boolean;
}

const SOON_MINUTES = 120;
const where = (c: CourseToday) => (c.room ? ` · ${c.room}` : "");
const span = (c: CourseToday) => `${formatMinutes(c.startMinutes)} – ${formatMinutes(c.endMinutes)}`;

/** Une seule information à la fois, la plus urgente : cours en cours, cours imminent, reprise, recommandation, progression. */
export function pickHighlight(i: HighlightInput): Highlight {
  const todayCourses = i.today.filter((c) => c.date === i.date);
  const current = todayCourses.find((c) => c.startMinutes <= i.nowMinutes && i.nowMinutes < c.endMinutes);
  const next = todayCourses.find((c) => c.startMinutes > i.nowMinutes);
  const agenda = "/agenda";
  if (current) return { kind: "course_now", eyebrow: "En ce moment", title: current.title, detail: `${span(current)}${where(current)}`, href: agenda, cta: "Voir l'agenda" };
  if (next && next.startMinutes - i.nowMinutes <= SOON_MINUTES) return { kind: "course_soon", eyebrow: `Dans ${next.startMinutes - i.nowMinutes} minutes`, title: next.title, detail: `${span(next)}${where(next)}`, href: agenda, cta: "Voir l'agenda" };
  if (i.resume) return { kind: "resume", eyebrow: "À reprendre", title: i.resume.title, detail: "Vous vous étiez arrêté ici.", href: i.resume.href, cta: i.resume.href ? "Reprendre" : null };
  if (i.recommendation) return { kind: "recommendation", eyebrow: "Priorité du moment", title: i.recommendation.title, detail: i.recommendation.text, href: null, cta: null };
  if (next) return { kind: "course_later", eyebrow: "Prochain cours", title: next.title, detail: `${span(next)}${where(next)}`, href: agenda, cta: "Voir l'agenda" };
  if (i.mastery !== null) return { kind: "progress", eyebrow: "Votre progression", title: `${Math.round(i.mastery * 100)} % de maîtrise estimée`, detail: "Calculée sur les notions pour lesquelles vous avez assez de résultats.", href: "/progression", cta: "Voir le détail" };
  if (i.hasSubjects) return { kind: "start", eyebrow: "Pour commencer", title: "Ouvrez un cours ou faites un exercice", detail: "Niala construira vos priorités à partir de votre travail réel.", href: "/matieres", cta: "Voir mes matières" };
  return { kind: "start", eyebrow: "Bienvenue", title: "Créez votre première matière", detail: "Importez vos cours et votre emploi du temps : ce tableau de bord se construira avec eux.", href: "/matieres", cta: "Créer une matière" };
}

export interface Suggestion {
  id: string;
  kind: "before_course" | "resume" | "recommendation" | "new_document";
  title: string;
  text: string;
  href: string | null;
  recommendationId?: string;
}

export interface SuggestionInput {
  date: string;
  nowMinutes: number;
  upcoming: CourseToday[];
  weakConcepts: { name: string; subjectId: string; level: number }[];
  recentDocuments: { name: string; subjectId: string; href: string }[];
  newDocuments: { id: string; name: string; subjectName: string; href: string }[];
  resume: { title: string; href: string | null } | null;
  recommendations: { id: string; title: string; text: string }[];
  highlight: Highlight;
  max?: number;
}

/** Suggestions justifiées : d'abord ce qui prépare les prochains cours, puis les reprises, recommandations et nouveaux documents. */
export function buildSuggestions(i: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const upcoming = i.upcoming.filter((c) => c.subjectId && (c.date > i.date || c.startMinutes > i.nowMinutes));
  for (const c of upcoming) {
    if (seen.has(c.subjectId!)) continue;
    seen.add(c.subjectId!);
    const when = `${c.date === i.date ? "aujourd'hui" : "demain"} à ${formatMinutes(c.startMinutes)}`;
    const weak = i.weakConcepts.filter((w) => w.subjectId === c.subjectId).sort((a, b) => a.level - b.level)[0];
    const doc = i.recentDocuments.find((d) => d.subjectId === c.subjectId);
    if (weak) out.push({ id: `course-${c.key}`, kind: "before_course", title: `Revoir « ${weak.name} »`, text: `Notion encore fragile, et vous avez ${c.subjectName ?? c.title} ${when}.`, href: `/matieres/${c.subjectId}` });
    else if (doc) out.push({ id: `course-${c.key}`, kind: "before_course", title: `Relire « ${doc.name} »`, text: `Pour préparer ${c.subjectName ?? c.title} ${when}.`, href: doc.href });
  }
  if (i.resume && i.highlight.kind !== "resume") out.push({ id: "resume", kind: "resume", title: `Reprendre : ${i.resume.title}`, text: "Activité commencée et non terminée.", href: i.resume.href });
  i.recommendations.forEach((r, n) => {
    if (n === 0 && i.highlight.kind === "recommendation") return;
    out.push({ id: `rec-${r.id}`, kind: "recommendation", title: r.title, text: r.text, href: null, recommendationId: r.id });
  });
  for (const d of i.newDocuments) out.push({ id: `doc-${d.id}`, kind: "new_document", title: `Découvrir « ${d.name} »`, text: `Ajouté dans ${d.subjectName}, pas encore ouvert.`, href: d.href });
  return out.slice(0, i.max ?? 4);
}
