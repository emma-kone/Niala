import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { assertFound } from "@/lib/ownership";
import { BAND_LABEL, DIFFICULTY_EVIDENCE_WEIGHT, MIN_CONFIDENCE, answerEvidenceScore, estimateMastery, masteryBand, type Evidence } from "@/server/domain/mastery";
import { buildRecommendations, type ConceptView, type ErrorTally } from "@/server/domain/recommend";
import { buildSuggestions, pickHighlight, type CourseToday, type ScheduleStatus } from "@/server/domain/dashboard";
import { addDays } from "@/server/domain/schedule";
import { occurrencesBetween } from "@/server/services/agenda/agenda";
import { listTasks, taskOverview } from "@/server/services/agenda/tasks";
import { isOpen } from "@/server/domain/academic";

// ─────────────────────────────────────────────────────────────────────────────
// Progression adaptative. Sources de vérité : les RÉPONSES corrigées et les TESTS de laboratoire.
// La maîtrise (ConceptMastery) est toujours recalculable depuis ces preuves ; rien n'y est saisi à la main.
// ─────────────────────────────────────────────────────────────────────────────

interface SnapQuestion {
  position: number;
  points: number;
  difficulty: string;
  type: string;
  concepts?: { id: string; name: string }[];
}

export interface EvidenceRow extends Evidence {
  conceptId: string;
  kind: "answer" | "lab";
  label: string;
  detail: Record<string, unknown>;
}

/** Toutes les preuves de l'étudiant, par notion. */
async function collectEvidence(userId: string): Promise<EvidenceRow[]> {
  const out: EvidenceRow[] = [];

  const [answers, labs] = await Promise.all([
    db.answer.findMany({
      where: { userId, attempt: { status: "GRADED", exerciseId: { not: null } } },
      select: { position: true, verdict: true, points: true, updatedAt: true, attemptId: true, attempt: { select: { snapshot: true, finishedAt: true, exercise: { select: { id: true, title: true } } } } },
      orderBy: { updatedAt: "desc" },
      take: 3000,
    }),
    // Laboratoire : dernier passage des tests d'un espace issu d'une question d'exercice.
    db.labWorkspace.findMany({ where: { userId, mode: "EXERCISE", exerciseId: { not: null } }, select: { id: true, title: true, exerciseId: true, brief: true }, take: 500 }),
  ]);
  for (const a of answers) {
    const snap = a.attempt.snapshot as { questions?: SnapQuestion[] } | null;
    const q = snap?.questions?.find((x) => x.position === a.position);
    if (!q?.concepts?.length) continue; // tentatives V1 migrées ou questions sans notion : pas de preuve par notion
    const score = answerEvidenceScore(a.verdict, a.points, q.points);
    if (score === null) continue;
    for (const c of q.concepts) {
      out.push({ conceptId: c.id, score, weight: DIFFICULTY_EVIDENCE_WEIGHT[q.difficulty] ?? 1, at: a.attempt.finishedAt ?? a.updatedAt, source: `attempt:${a.attemptId}`, kind: "answer", label: a.attempt.exercise?.title ?? "Exercice", detail: { attemptId: a.attemptId, exerciseId: a.attempt.exercise?.id, position: a.position, verdict: a.verdict, points: a.points, max: q.points } });
    }
  }

  // Une lecture groupée des exécutions et une des questions, au lieu de deux lectures par espace de travail.
  const fromQuestion = labs.flatMap((w) => {
    const brief = w.brief as { origin?: string; source?: { position?: number } } | null;
    return brief?.origin === "question" && brief.source?.position ? [{ ...w, position: brief.source.position }] : [];
  });
  const [labRuns, labQuestions] = fromQuestion.length
    ? await Promise.all([
        db.labRun.findMany({ where: { userId, workspaceId: { in: fromQuestion.map((w) => w.id) } }, orderBy: { createdAt: "desc" }, select: { workspaceId: true, tests: true, createdAt: true }, take: 20 * fromQuestion.length }),
        db.question.findMany({ where: { userId, OR: fromQuestion.map((w) => ({ exerciseId: w.exerciseId!, position: w.position })) }, select: { exerciseId: true, position: true, difficulty: true, concepts: { where: { concept: { deletedAt: null } }, select: { conceptId: true } } } }),
      ])
    : [[], []];
  for (const w of fromQuestion) {
    // Comme avant : parmi les 20 dernières exécutions de l'espace, la plus récente qui a passé des tests.
    const last = labRuns.filter((r) => r.workspaceId === w.id).slice(0, 20).find((r) => (r.tests as { summary?: unknown } | null)?.summary);
    if (!last) continue;
    const ratio = (last.tests as { summary: { ratio: number; passed: number; total: number } }).summary;
    const q = labQuestions.find((x) => x.exerciseId === w.exerciseId && x.position === w.position);
    if (!q) continue;
    for (const c of q.concepts) {
      out.push({ conceptId: c.conceptId, score: ratio.ratio, weight: DIFFICULTY_EVIDENCE_WEIGHT[q.difficulty] ?? 1, at: last.createdAt, source: `lab:${w.id}`, kind: "lab", label: w.title, detail: { workspaceId: w.id, passed: ratio.passed, total: ratio.total } });
    }
  }
  return out;
}

/** Recalcule la maîtrise de toutes les notions à partir des preuves (idempotent). */
export async function recomputeMastery(userId: string) {
  const evidence = await collectEvidence(userId);
  const byConcept = new Map<string, EvidenceRow[]>();
  for (const e of evidence) byConcept.set(e.conceptId, [...(byConcept.get(e.conceptId) ?? []), e]);
  const existing = new Set((await db.concept.findMany({ where: { userId, id: { in: [...byConcept.keys()] } }, select: { id: true } })).map((c) => c.id));
  const now = new Date();
  let updated = 0;
  for (const [conceptId, list] of byConcept) {
    if (!existing.has(conceptId)) continue;
    const est = estimateMastery(list, now);
    await db.conceptMastery.upsert({
      where: { conceptId },
      create: { conceptId, userId, level: est.level, confidence: est.confidence, evidenceCount: est.evidenceCount, lastEvidenceAt: est.lastEvidenceAt },
      update: { level: est.level, confidence: est.confidence, evidenceCount: est.evidenceCount, lastEvidenceAt: est.lastEvidenceAt },
    });
    updated++;
  }
  // une notion qui n'a plus aucune preuve (exercice supprimé…) n'a plus de maîtrise estimée
  await db.conceptMastery.deleteMany({ where: { userId, conceptId: { notIn: [...existing] } } });
  return { concepts: updated, evidence: evidence.length };
}

// ── Recommandations ──────────────────────────────────────────────────────────

/** Le tableau de bord n'affiche pas les prérequis : `light` évite de charger le graphe complet des notions. */
async function loadConceptViews(userId: string, subjectId?: string, light = false): Promise<(ConceptView & { subjectName: string })[]> {
  const where = { userId, ...(subjectId ? { subjectId } : {}) };
  type Prerequisite = { from: { id: string; name: string; mastery: { level: number; confidence: number; evidenceCount: number } | null } };
  // Mode allégé : aucune lecture des prérequis (auparavant un filtre impossible, mais les requêtes partaient quand même).
  const concepts = light
    ? (await db.concept.findMany({ where, include: { mastery: true, subject: { select: { name: true } } }, take: 2000 })).map((c) => ({ ...c, incoming: [] as Prerequisite[] }))
    : await db.concept.findMany({ where, include: { mastery: true, subject: { select: { name: true } }, incoming: { where: { type: "PREREQUISITE" }, include: { from: { include: { mastery: true } } } } }, take: 2000 });
  return concepts.map((c) => ({
    id: c.id,
    name: c.name,
    subjectId: c.subjectId,
    subjectName: c.subject.name,
    importance: c.importance,
    level: c.mastery?.level ?? 0,
    confidence: c.mastery?.confidence ?? 0,
    evidenceCount: c.mastery?.evidenceCount ?? 0,
    lastEvidenceAt: c.mastery?.lastEvidenceAt ?? null,
    prerequisites: (c.incoming as Prerequisite[]).map((r) => ({ id: r.from.id, name: r.from.name, level: r.from.mastery?.level ?? 0, confidence: r.from.mastery?.confidence ?? 0, evidenceCount: r.from.mastery?.evidenceCount ?? 0 })),
  }));
}

async function errorTallies(userId: string): Promise<ErrorTally[]> {
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const rows = await db.errorDiagnosis.findMany({ where: { userId, createdAt: { gte: since }, labRunId: { not: null } }, select: { evidence: true, category: true, labRun: { select: { workspace: { select: { subjectId: true, kind: true } } } } }, take: 1000 });
  const map = new Map<string, ErrorTally>();
  for (const r of rows) {
    const ev = r.evidence as { source?: string; kind?: string; label?: string } | null;
    if (!ev || ev.source === "ai" || !ev.kind) continue; // les hypothèses de l'IA ne fondent pas une recommandation
    const ws = r.labRun?.workspace;
    if (!ws) continue;
    const key = `${ws.kind}:${ev.kind}:${ws.subjectId}`;
    const t = map.get(key) ?? { kind: ev.kind, category: r.category, count: 0, label: ev.label ?? ev.kind, subjectId: ws.subjectId, labKind: ws.kind };
    t.count++;
    map.set(key, t);
  }
  return [...map.values()];
}

const DISMISS_DAYS = 7;

/** Régénère les recommandations (hors celles que l'étudiant a écartées récemment). */
export async function refreshRecommendations(userId: string) {
  const concepts = await loadConceptViews(userId);
  const recs = buildRecommendations(concepts, await errorTallies(userId));
  const since = new Date(Date.now() - DISMISS_DAYS * 24 * 3600 * 1000);
  const dismissed = await db.learningRecommendation.findMany({ where: { userId, status: "DISMISSED", createdAt: { gte: since } }, select: { reason: true } });
  const dismissedKeys = new Set(dismissed.map((d) => (d.reason as { key?: string } | null)?.key).filter(Boolean));
  const kept = recs.filter((r) => !dismissedKeys.has(r.key));

  const docOf = new Map<string, string>();
  for (const r of kept) {
    if (!r.conceptId) continue;
    const src = await db.conceptSource.findFirst({ where: { userId, conceptId: r.conceptId }, orderBy: { id: "desc" }, select: { analysis: { select: { version: { select: { documentId: true } } } } } });
    const d = src?.analysis.version.documentId;
    if (d) docOf.set(r.conceptId, d);
  }
  await db.$transaction([
    db.learningRecommendation.deleteMany({ where: { userId, status: "SUGGESTED" } }),
    db.learningRecommendation.createMany({
      data: kept.map((r) => ({
        userId,
        subjectId: r.subjectId,
        conceptId: r.conceptId,
        activityType: r.type,
        reason: { key: r.key, priority: r.priority, title: r.title, text: r.text, evidence: r.evidence, documentId: r.conceptId ? (docOf.get(r.conceptId) ?? null) : null } as unknown as Prisma.InputJsonValue,
      })),
    }),
  ]);
  return kept.length;
}

/** À appeler après une correction ou une exécution de tests : jamais bloquant pour l'action de l'étudiant. */
export async function refreshProgress(userId: string) {
  try {
    await recomputeMastery(userId);
    await refreshRecommendations(userId);
  } catch (e) {
    console.error("[progress] recalcul impossible", e instanceof Error ? e.message : e);
  }
}

export async function listRecommendations(userId: string, subjectId?: string) {
  const rows = await db.learningRecommendation.findMany({ where: { userId, status: "SUGGESTED", ...(subjectId ? { subjectId } : {}) }, include: { subject: { select: { name: true, color: true, icon: true } }, concept: { select: { name: true } } }, take: 50 });
  return rows
    .map((r) => {
      const reason = r.reason as { key: string; priority: number; title: string; text: string; evidence: Record<string, unknown>; documentId: string | null };
      return { id: r.id, type: r.activityType, subjectId: r.subjectId, subject: r.subject, conceptId: r.conceptId, concept: r.concept?.name ?? null, title: reason.title, text: reason.text, evidence: reason.evidence, documentId: reason.documentId, priority: reason.priority };
    })
    .sort((a, b) => b.priority - a.priority);
}

export async function updateRecommendation(userId: string, id: string, status: "DISMISSED" | "DONE") {
  const r = assertFound(await db.learningRecommendation.findFirst({ where: { id, userId } }), "Recommandation");
  await db.learningRecommendation.update({ where: { id: r.id }, data: { status } });
  return { ok: true };
}

// ── Tableau de bord ──────────────────────────────────────────────────────────

const subjectHref = (s: string) => `/matieres/${s}`;

/** Un exercice libre ou importé n'a pas de matière : il est rangé directement sous /exercices. */
const exerciseHref = (subjectId: string | null, exerciseId: string) => (subjectId ? `${subjectHref(subjectId)}/exercices/${exerciseId}` : `/exercices/${exerciseId}`);

async function activityHref(userId: string, a: { type: string; refType: string | null; refId: string | null; subjectId: string | null; lastPosition: unknown }): Promise<string | null> {
  if (!a.refId) return null;
  if (a.refType === "document" && a.subjectId) {
    const page = (a.lastPosition as { page?: number } | null)?.page;
    return `${subjectHref(a.subjectId)}/documents/${a.refId}${page ? `?page=${page}` : ""}`;
  }
  if (a.refType === "attempt") {
    const att = await db.exerciseAttempt.findFirst({ where: { id: a.refId, userId }, select: { exerciseId: true, exercise: { select: { subjectId: true, deletedAt: true } } } });
    // Un exercice supprimé garde ses tentatives (statistiques) mais n'est plus proposé à l'étudiant.
    return att?.exerciseId && att.exercise && !att.exercise.deletedAt ? `${exerciseHref(att.exercise.subjectId, att.exerciseId)}/tentatives/${a.refId}` : null;
  }
  if (a.refType === "lab") return `${a.type === "LAB_SQL" ? "/sql" : "/code"}/${a.refId}`;
  return null;
}

/** Horizon de recherche du prochain cours quand la journée présentée n'en a plus (vacances courtes comprises). */
const NEXT_COURSE_HORIZON_DAYS = 21;

/** Agenda indisponible : le tableau de bord reste utilisable et le signale, au lieu d'annoncer une journée sans cours. */
async function courseWindow(userId: string, from: string, to: string): Promise<{ courses: CourseToday[]; schedule: ScheduleStatus; breaks: { label: string; startMinutes: number; endMinutes: number; weekday: number | null }[] }> {
  try {
    // Les pauses et le nombre de cours viennent de la même lecture que les séances (auparavant : deux lectures de plus,
    // chacune précédée d'une relecture de l'emploi du temps suivi).
    const { occurrences, breaks, totalEvents: events } = await occurrencesBetween(userId, from, to);
    const courses = occurrences.filter((o) => !o.allDay).map((o) => ({ key: o.key, date: o.date, title: o.title, startMinutes: o.startMinutes, endMinutes: o.endMinutes, room: o.room, subjectId: o.subjectId, subjectName: o.subject?.name ?? null, teacher: o.teacher, subjectColor: o.subject?.color ?? null, subjectIcon: o.subject?.icon ?? null }));
    return { courses, schedule: events > 0 ? "ok" : "empty", breaks: breaks.map(({ label, startMinutes, endMinutes, weekday }) => ({ label, startMinutes, endMinutes, weekday })) };
  } catch (e) {
    console.warn("[dashboard] agenda indisponible :", e instanceof Error ? e.message : e);
    return { courses: [], schedule: "error", breaks: [] };
  }
}

const EMPTY_AGENDA = { late: [], upcoming: [], priority: [], sessions: [] };

/** Tâches et séances prévues : même source que l'agenda, sans bloquer le tableau de bord en cas d'erreur. */
async function agendaOverview(userId: string, clock: { date: string; minutes: number }) {
  try {
    const tasks = await listTasks(userId, clock);
    const { late, upcoming } = taskOverview(tasks, clock.date);
    const brief = (t: (typeof tasks)[number]) => ({ id: t.id, title: t.title, type: t.type, status: t.status, priority: t.priority, dueDate: t.dueDate, dueMinutes: t.dueMinutes, subjectName: t.subject?.name ?? null });
    return {
      late: late.map(brief),
      upcoming: upcoming.map(brief),
      priority: tasks.filter((t) => isOpen(t.status) && t.priority === "HAUTE").slice(0, 5).map(brief),
      // Aujourd'hui et demain : le client présente l'une ou l'autre journée selon l'heure.
      sessions: tasks.flatMap((t) => t.sessions.filter((s) => s.date === clock.date || s.date === addDays(clock.date, 1)).map((s) => ({ id: s.id, date: s.date, title: t.title, startMinutes: s.startMinutes, endMinutes: s.endMinutes, done: s.done }))),
    };
  } catch (e) {
    console.warn("[dashboard] tâches indisponibles :", e instanceof Error ? e.message : e);
    return EMPTY_AGENDA;
  }
}

export async function dashboard(userId: string, clock: { date: string; minutes: number }) {
  const tomorrow = addDays(clock.date, 1);
  // Toutes les lectures sont indépendantes : elles partent ensemble pour que le temps de réponse soit celui de la plus lente.
  const [{ courses, schedule, breaks }, recentDocs, unopened, subjects, concepts, activities, recs, failedDocs, attempts, labRuns, academic] = await Promise.all([
    courseWindow(userId, clock.date, addDays(clock.date, NEXT_COURSE_HORIZON_DAYS)),
    // Classement sur la dernière consultation réelle ; un document n'y figure qu'une fois, même ouvert plusieurs fois.
    db.document.findMany({ where: { userId, lastOpenedAt: { not: null }, subjectId: { not: null } }, orderBy: [{ lastOpenedAt: "desc" }, { id: "asc" }], take: 3, select: { id: true, name: true, type: true, subjectId: true, lastOpenedAt: true, lastPage: true, pageCount: true, currentVersion: { select: { pageCount: true } }, subject: { select: { name: true, color: true, icon: true } } } }),
    db.document.findMany({ where: { userId, lastOpenedAt: null, subjectId: { not: null } }, orderBy: { createdAt: "desc" }, take: 2, select: { id: true, name: true, subjectId: true, subject: { select: { name: true } } } }),
    db.subject.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, color: true, icon: true, _count: { select: { documents: { where: { deletedAt: null } }, studyExercises: { where: { deletedAt: null } }, notes: { where: { deletedAt: null } } } } } }),
    loadConceptViews(userId, undefined, true),
    db.learningActivity.findMany({ where: { userId, status: "IN_PROGRESS" }, orderBy: { updatedAt: "desc" }, take: 5 }),
    listRecommendations(userId),
    db.document.findMany({ where: { userId, versions: { some: { extractStatus: "FAILED" } } }, select: { id: true, name: true, subjectId: true }, take: 5 }),
    db.exerciseAttempt.findMany({ where: { userId, status: "GRADED", exerciseId: { not: null }, exercise: { is: { deletedAt: null } } }, orderBy: { finishedAt: "desc" }, take: 5, select: { id: true, score: true, maxScore: true, finishedAt: true, exerciseId: true, exercise: { select: { title: true, subjectId: true } } } }),
    db.labRun.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, createdAt: true, tests: true, workspace: { select: { id: true, title: true, kind: true } } } }),
    agendaOverview(userId, clock),
  ]);

  const perSubject = subjects.map((s) => {
    const cs = concepts.filter((c) => c.subjectId === s.id);
    const measured = cs.filter((c) => c.confidence >= MIN_CONFIDENCE);
    const bands = measured.map((c) => masteryBand(c.level, c.confidence));
    const avg = measured.length ? measured.reduce((t, c) => t + c.level, 0) / measured.length : null;
    return {
      id: s.id,
      name: s.name,
      color: s.color,
      documents: s._count.documents,
      exercises: s._count.studyExercises,
      notes: s._count.notes,
      concepts: { total: cs.length, measured: measured.length, fragile: bands.filter((b) => b === "fragile").length, solid: bands.filter((b) => b === "solid" || b === "to_confirm").length },
      mastery: avg === null ? null : Math.round(avg * 100) / 100,
      confidence: measured.length ? Math.round((measured.reduce((t, c) => t + c.confidence, 0) / measured.length) * 100) / 100 : 0,
    };
  });

  const resumeA = activities[0];
  const hrefs = await Promise.all(activities.slice(0, 4).map((a) => activityHref(userId, a)));
  const resume = resumeA ? { type: resumeA.type, title: resumeA.title, subjectId: resumeA.subjectId, updatedAt: resumeA.updatedAt, href: hrefs[0] } : null;

  const attention: { kind: string; text: string; href?: string }[] = [];
  for (const d of failedDocs) attention.push({ kind: "document_failed", text: `Le texte de « ${d.name} » n'a pas pu être extrait : il reste consultable, mais pas analysable.`, href: d.subjectId ? `${subjectHref(d.subjectId)}/documents/${d.id}` : undefined });
  for (const c of concepts.filter((c) => c.confidence >= MIN_CONFIDENCE && c.level < 0.5).sort((a, b) => a.level - b.level).slice(0, 3)) attention.push({ kind: "weak_concept", text: `« ${c.name} » (${c.subjectName}) : maîtrise fragile, ${Math.round(c.level * 100)} % d'après ${c.evidenceCount} réponse(s).`, href: `${subjectHref(c.subjectId)}` });
  activities.slice(1, 4).forEach((a, i) => attention.push({ kind: "in_progress", text: `Activité en cours : ${a.title}`, href: hrefs[i + 1] ?? undefined }));

  const recent = [
    ...attempts.map((a) => ({ kind: "exercise", title: a.exercise?.title ?? "Exercice", at: a.finishedAt, detail: a.score != null && a.maxScore ? `${Math.round(a.score * 100) / 100} / ${a.maxScore}` : null, href: a.exercise && a.exerciseId ? `${exerciseHref(a.exercise.subjectId, a.exerciseId)}/tentatives/${a.id}` : null })),
    ...labRuns.map((r) => {
      const sum = (r.tests as { summary?: { passed: number; total: number } } | null)?.summary;
      return { kind: r.workspace.kind === "SQL" ? "lab_sql" : "lab_code", title: r.workspace.title, at: r.createdAt, detail: sum ? `${sum.passed}/${sum.total} tests` : "exécution libre", href: `${r.workspace.kind === "SQL" ? "/sql" : "/code"}/${r.workspace.id}` };
    }),
  ]
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
    .slice(0, 6);

  const documentHref = (d: { id: string; subjectId: string | null; lastPage?: number | null }) => `/matieres/${d.subjectId}/documents/${d.id}${d.lastPage ? `?page=${d.lastPage}` : ""}`;
  const recentDocuments = recentDocs.map((d) => ({ id: d.id, name: d.name, type: d.type, lastOpenedAt: d.lastOpenedAt, lastPage: d.lastPage, pageCount: d.pageCount ?? d.currentVersion?.pageCount ?? null, subjectId: d.subjectId!, subjectName: d.subject?.name ?? "", subjectColor: d.subject?.color ?? "#8b5cf6", subjectIcon: d.subject?.icon ?? null, href: documentHref(d) }));
  const measuredSubjects = perSubject.filter((s) => s.mastery !== null);
  const overallMastery = measuredSubjects.length ? Math.round((measuredSubjects.reduce((t, s) => t + s.mastery!, 0) / measuredSubjects.length) * 100) / 100 : null;
  const urgent = academic.late[0] ?? academic.upcoming.find((t) => t.dueDate <= tomorrow) ?? null;
  const task = urgent ? { title: urgent.title, late: urgent.status === "EN_RETARD", detail: `Date limite : ${new Date(`${urgent.dueDate}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}${urgent.subjectName ? ` · ${urgent.subjectName}` : ""}` } : null;
  const highlight = pickHighlight({ date: clock.date, nowMinutes: clock.minutes, today: courses, resume, recommendation: recs[0] ?? null, task, mastery: overallMastery, hasSubjects: subjects.length > 0 });
  // La grande carte présente le dernier document ouvert : sa reprise n'est pas répétée dans les suggestions.
  const resumeElsewhere = resumeA && !(resumeA.refType === "document" && resumeA.refId === recentDocs[0]?.id) ? resume : null;
  const suggestions = buildSuggestions({
    date: clock.date,
    nowMinutes: clock.minutes,
    upcoming: courses.filter((c) => c.date <= tomorrow),
    weakConcepts: concepts.filter((c) => c.confidence >= MIN_CONFIDENCE && c.level < 0.5).map((c) => ({ name: c.name, subjectId: c.subjectId, level: c.level })),
    recentDocuments: recentDocuments.flatMap((d, i) => (recentDocs[i].subjectId ? [{ name: d.name, subjectId: recentDocs[i].subjectId, href: d.href }] : [])),
    newDocuments: unopened.map((d) => ({ id: d.id, name: d.name, subjectName: d.subject?.name ?? "", href: documentHref(d) })),
    resume: resumeElsewhere,
    recommendations: recs,
    // Sans document consulté, la grande carte affiche l'information principale : elle n'est alors pas répétée.
    highlight: recentDocs.length ? undefined : highlight,
  });

  return { resume, next: recs[0] ?? null, recommendations: recs.slice(0, 5), attention, subjects: perSubject, recent, hasData: subjects.length > 0, recentDocuments, today: courses, schedule, breaks, academic, highlight, suggestions, overallMastery };
}

// ── Page Progression ─────────────────────────────────────────────────────────

export async function progress(userId: string, subjectId?: string) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  // Lectures indépendantes, lancées ensemble (la matière demandée est vérifiée dans la même vague).
  const [subject, concepts, attempts, diag] = await Promise.all([
    subjectId ? db.subject.findFirst({ where: { id: subjectId, userId }, select: { id: true } }) : null,
    loadConceptViews(userId, subjectId),
    db.exerciseAttempt.findMany({
      where: { userId, status: "GRADED", exerciseId: { not: null }, ...(subjectId ? { exercise: { subjectId } } : {}) },
      orderBy: { finishedAt: "asc" },
      take: 100,
      select: { id: true, score: true, maxScore: true, finishedAt: true, exercise: { select: { title: true, subject: { select: { id: true, name: true, color: true, icon: true } } } } },
    }),
    db.errorDiagnosis.findMany({ where: { userId, createdAt: { gte: since } }, select: { category: true, evidence: true, conceptId: true } }),
  ]);
  if (subjectId) assertFound(subject, "Matière");
  const byCategory = new Map<string, number>();
  for (const d of diag) if ((d.evidence as { source?: string } | null)?.source !== "ai") byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + 1);
  const hypotheses = diag.filter((d) => (d.evidence as { source?: string } | null)?.source === "ai").length;

  return {
    concepts: concepts
      .map((c) => ({ id: c.id, name: c.name, subjectId: c.subjectId, subjectName: c.subjectName, importance: c.importance, level: c.level, confidence: c.confidence, evidenceCount: c.evidenceCount, lastEvidenceAt: c.lastEvidenceAt, band: masteryBand(c.level, c.confidence), bandLabel: BAND_LABEL[masteryBand(c.level, c.confidence)], prerequisites: c.prerequisites.map((p) => ({ id: p.id, name: p.name })) }))
      .sort((a, b) => (a.band === "unknown" ? 1 : 0) - (b.band === "unknown" ? 1 : 0) || a.level - b.level),
    // Les notes sont présentées séparément de la maîtrise : une note d'exercice n'est pas une mesure de maîtrise.
    attempts: attempts.map((a) => ({ id: a.id, title: a.exercise?.title ?? "Exercice", subject: a.exercise?.subject ?? null, at: a.finishedAt, percentage: a.maxScore ? Math.round(((a.score ?? 0) / a.maxScore) * 1000) / 10 : null })),
    errors: [...byCategory.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    hypotheses,
  };
}

export async function conceptDetail(userId: string, conceptId: string) {
  const [found, allEvidence] = await Promise.all([
    db.concept.findFirst({ where: { id: conceptId, userId }, include: { mastery: true, subject: { select: { id: true, name: true } }, sources: { take: 3, include: { section: { select: { label: true, pageStart: true } } } } } }),
    collectEvidence(userId),
  ]);
  const c = assertFound(found, "Notion");
  const evidence = allEvidence.filter((e) => e.conceptId === conceptId).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 30);
  const est = c.mastery ? { level: c.mastery.level, confidence: c.mastery.confidence, band: masteryBand(c.mastery.level, c.mastery.confidence) } : null;
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    importance: c.importance,
    mastery: est ? { ...est, bandLabel: BAND_LABEL[est.band], evidenceCount: c.mastery!.evidenceCount, lastEvidenceAt: c.mastery!.lastEvidenceAt } : null,
    sections: c.sources.filter((s) => s.section).map((s) => ({ label: s.section!.label, page: s.section!.pageStart })),
    evidence: evidence.map((e) => ({ kind: e.kind, label: e.label, score: e.score, weight: e.weight, at: e.at, detail: e.detail })),
    howItIsComputed: "Maîtrise estimée à partir des réponses corrigées et des tests de laboratoire liés à cette notion, pondérés par la difficulté, avec une décroissance dans le temps (demi-vie de 30 jours). La confiance dépend du nombre et de la variété des preuves.",
  };
}

export async function ensureOwnedSubject(userId: string, id: string) {
  const s = await db.subject.findFirst({ where: { id, userId }, select: { id: true } });
  if (!s) throw new ApiHttpError("Matière introuvable.", 404);
}
