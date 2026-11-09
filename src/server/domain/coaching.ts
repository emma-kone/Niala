// ─────────────────────────────────────────────────────────────────────────────
// Moteur de suggestions pédagogiques : fonction PURE, sans base ni IA.
// Chaque conseil naît d'observations chiffrées, répétées sur plusieurs sessions : une seule erreur ou une seule session
// n'est jamais une conclusion. Chaque conseil porte ses preuves (evidence) et ses actions directes. Quand les données
// manquent, le moteur le dit au lieu d'inventer une difficulté.
// ─────────────────────────────────────────────────────────────────────────────

export type InsightCategory = "ADVICE" | "ACTIVITY" | "PROGRESS" | "ALERT";
export type ActionKind = "open_course" | "resume_attempt" | "retry_exercise" | "new_series" | "test" | "lab";

export interface InsightAction {
  kind: ActionKind;
  label: string;
  href: string;
}
export interface Insight {
  /** Clé stable : sert à écarter un conseil et à ne pas le réafficher. */
  key: string;
  category: InsightCategory;
  tone: "positive" | "neutral" | "warning";
  title: string;
  text: string;
  /** Observations chiffrées qui fondent le conseil. */
  evidence: { label: string; value: string }[];
  confidence: "faible" | "moyenne" | "bonne";
  subjectId: string | null;
  priority: number;
  actions: InsightAction[];
}

export interface CoachAttempt {
  id: string;
  exerciseId: string | null;
  title: string;
  subjectId: string | null;
  subjectName: string | null;
  documentId: string | null;
  status: "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  startedAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
  /** Score / maximum, entre 0 et 1, une fois corrigée. */
  ratio: number | null;
  durationSec: number | null;
  answered: number;
  total: number;
}
export interface CoachAnswer {
  attemptId: string;
  subjectId: string | null;
  subjectName: string | null;
  conceptIds: string[];
  conceptNames: string[];
  verdict: string | null;
  tries: number;
}
export interface CoachHint {
  attemptId: string;
  subjectId: string | null;
  conceptNames: string[];
}
export interface CoachError {
  category: string;
  label: string;
  attemptId: string | null;
  subjectId: string | null;
  at: Date;
}
export interface CoachConcept {
  id: string;
  name: string;
  subjectId: string;
  subjectName: string;
  level: number;
  confidence: number;
  evidenceCount: number;
  documentId: string | null;
}
export interface CoachInput {
  attempts: CoachAttempt[];
  answers: CoachAnswer[];
  hints: CoachHint[];
  errors: CoachError[];
  concepts: CoachConcept[];
  weeklyGoal: number;
  now: Date;
}
export interface CoachReport {
  status: "ok" | "insufficient";
  insights: Insight[];
  summary: { gradedAttempts: number; answers: number; activeDays14: number };
  /** Présent quand les données sont trop rares pour tirer des conclusions. */
  missing: string | null;
}

// ── Seuils : tout conseil exige plusieurs observations indépendantes ──
export const MIN_GRADED_ATTEMPTS = 2;
export const MIN_ANSWERS = 6;
const PERSISTENT_MIN_ANSWERS = 3;
const PERSISTENT_MIN_ATTEMPTS = 2;
const PERSISTENT_MIN_WRONG_RATIO = 0.6;
const RECURRING_ERRORS_MIN = 3;
const HINTS_MIN = 5;
const TREND_MIN_ATTEMPTS = 4;
const TREND_DELTA = 0.15;
const ABANDONED_AFTER_DAYS = 2;
const INACTIVE_AFTER_DAYS = 5;
const MASTERED_LEVEL = 0.75;
const DAY = 24 * 3600 * 1000;

const pct = (n: number) => `${Math.round(n * 100)} %`;
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const subjectLabel = (name: string | null) => name ?? "exercices libres";
const wrongWeight = (verdict: string | null) => (verdict === "incorrect" ? 1 : verdict === "partial" ? 0.5 : 0);

export const CATEGORY_LABEL: Record<string, string> = {
  SYNTAX: "de syntaxe",
  LOGIC: "de logique",
  CONCEPT: "de compréhension d'une notion",
  METHOD: "de méthode",
  INSTRUCTION: "de lecture de la consigne",
  FORGETTING: "d'oubli",
  CARELESS: "d'étourderie",
};

/** Début de la semaine (lundi 00 h) de la date donnée. */
export function weekStart(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export interface HrefBuilders {
  course: (subjectId: string, documentId: string) => string;
  attempt: (subjectId: string | null, exerciseId: string, attemptId: string) => string;
  exercise: (subjectId: string | null, exerciseId: string) => string;
  /** Exercice ciblé : sur un cours, une notion, ou librement. */
  series: (p: { subjectId?: string | null; documentId?: string | null; conceptId?: string; subject?: string; chapter?: string; difficulty?: string; count?: number; mode?: string }) => string;
}

export function buildInsights(input: CoachInput, href: HrefBuilders, max = 8): CoachReport {
  const { attempts, answers, hints, errors, concepts, now } = input;
  const graded = attempts.filter((a) => a.status === "GRADED" && a.ratio !== null).sort((a, b) => (a.finishedAt ?? a.startedAt).getTime() - (b.finishedAt ?? b.startedAt).getTime());
  const days14 = new Set(attempts.filter((a) => now.getTime() - a.updatedAt.getTime() <= 14 * DAY).map((a) => a.updatedAt.toISOString().slice(0, 10)));
  const summary = { gradedAttempts: graded.length, answers: answers.length, activeDays14: days14.size };
  const out: Insight[] = [];
  const attemptById = new Map(attempts.map((a) => [a.id, a]));

  // ── Activités à reprendre : exactes même avec peu de données ──
  const abandoned = attempts
    .filter((a) => a.status === "IN_PROGRESS" && a.answered > 0 && a.answered < a.total && now.getTime() - a.updatedAt.getTime() >= ABANDONED_AFTER_DAYS * DAY && a.exerciseId)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 2);
  for (const a of abandoned) {
    const days = Math.floor((now.getTime() - a.updatedAt.getTime()) / DAY);
    out.push({
      key: `resume:${a.id}`,
      category: "ACTIVITY",
      tone: "neutral",
      title: `Reprendre « ${a.title} »`,
      text: `Cet exercice est resté en cours depuis ${days} jour(s) : ${a.answered} question(s) sur ${a.total} ont déjà une réponse enregistrée.`,
      evidence: [{ label: "Avancement", value: `${a.answered} / ${a.total}` }, { label: "Dernière activité", value: `il y a ${days} jour(s)` }],
      confidence: "bonne",
      subjectId: a.subjectId,
      priority: 70,
      actions: [{ kind: "resume_attempt", label: "Reprendre l'exercice", href: href.attempt(a.subjectId, a.exerciseId!, a.id) }],
    });
  }

  const enough = graded.length >= MIN_GRADED_ATTEMPTS && answers.length >= MIN_ANSWERS;
  if (!enough) {
    const missing = `Pas encore assez de données pour des conseils fiables : il faut au moins ${MIN_GRADED_ATTEMPTS} exercices terminés et ${MIN_ANSWERS} réponses (vous en avez ${graded.length} et ${answers.length}). Terminez quelques exercices et les observations apparaîtront ici.`;
    return { status: "insufficient", insights: out.sort((a, b) => b.priority - a.priority).slice(0, max), summary, missing };
  }

  // ── Difficulté persistante sur une notion : plusieurs réponses, plusieurs sessions ──
  const byConcept = new Map<string, { name: string; subjectId: string | null; items: CoachAnswer[] }>();
  for (const ans of answers) {
    ans.conceptIds.forEach((id, i) => {
      const e = byConcept.get(id) ?? { name: ans.conceptNames[i] ?? "cette notion", subjectId: ans.subjectId, items: [] };
      e.items.push(ans);
      byConcept.set(id, e);
    });
  }
  const conceptInfo = new Map(concepts.map((c) => [c.id, c]));
  for (const [id, c] of byConcept) {
    const n = c.items.length;
    const sessions = uniq(c.items.map((x) => x.attemptId));
    const wrongSessions = uniq(c.items.filter((x) => wrongWeight(x.verdict) > 0).map((x) => x.attemptId));
    const wrong = c.items.reduce((s, x) => s + wrongWeight(x.verdict), 0);
    const ratio = wrong / n;
    if (n < PERSISTENT_MIN_ANSWERS || sessions.length < PERSISTENT_MIN_ATTEMPTS || wrongSessions.length < PERSISTENT_MIN_ATTEMPTS || ratio < PERSISTENT_MIN_WRONG_RATIO) continue;
    const info = conceptInfo.get(id);
    const related = sessions.map((s) => attemptById.get(s)).filter((a): a is CoachAttempt => !!a);
    const slow = related.filter((a) => a.durationSec && a.ratio !== null && a.ratio < 0.5);
    const durations = graded.map((a) => a.durationSec).filter((d): d is number => !!d);
    const evidence = [
      { label: "Réponses fausses ou partielles", value: `${Math.round(wrong * 10) / 10} sur ${n}` },
      { label: "Sessions concernées", value: `${wrongSessions.length} sur ${sessions.length}` },
      ...(slow.length && durations.length >= 5 && slow.some((a) => a.durationSec! > 2 * median(durations)) ? [{ label: "Temps", value: "plus long que d'habitude sur ces exercices" }] : []),
    ];
    const actions: InsightAction[] = [];
    if (info?.documentId && c.subjectId) actions.push({ kind: "open_course", label: "Revoir le cours", href: href.course(c.subjectId, info.documentId) });
    actions.push({ kind: "new_series", label: "Série ciblée", href: href.series({ subjectId: c.subjectId, documentId: info?.documentId, conceptId: id, subject: c.items[0].subjectName ?? undefined, chapter: c.name, difficulty: "progressive", count: 5 }) });
    out.push({
      key: `difficulty:${id}`,
      category: "ALERT",
      tone: "warning",
      title: `Difficulté persistante : « ${c.name} »`,
      text: `Vous rencontrez régulièrement des difficultés sur « ${c.name} » (${subjectLabel(c.items[0].subjectName)}) : ${pct(ratio)} de vos réponses sur cette notion sont fausses ou partielles, sur ${wrongSessions.length} sessions différentes.`,
      evidence,
      confidence: n >= 6 && wrongSessions.length >= 3 ? "bonne" : "moyenne",
      subjectId: c.subjectId,
      priority: 90 + ratio * 20 + Math.min(n, 10),
      actions,
    });
  }

  // ── Erreurs récurrentes (diagnostics) ──
  const byCategory = new Map<string, CoachError[]>();
  for (const e of errors) byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), e]);
  for (const [category, list] of byCategory) {
    const sessions = uniq(list.map((e) => e.attemptId ?? e.at.toISOString().slice(0, 10)));
    if (list.length < RECURRING_ERRORS_MIN || sessions.length < 2) continue;
    const labels = new Map<string, number>();
    for (const e of list) labels.set(e.label, (labels.get(e.label) ?? 0) + 1);
    const [topLabel, topCount] = [...labels.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({
      key: `errors:${category}`,
      category: "ALERT",
      tone: "warning",
      title: "Certaines erreurs reviennent",
      text: `Vos derniers exercices montrent des erreurs ${CATEGORY_LABEL[category] ?? category} à répétition. La plus fréquente : « ${topLabel} ».`,
      evidence: [{ label: "Erreurs de ce type", value: String(list.length) }, { label: "Sessions", value: String(sessions.length) }, { label: "Plus fréquente", value: `${topLabel} (${topCount})` }],
      confidence: list.length >= 5 ? "bonne" : "moyenne",
      subjectId: list.find((e) => e.subjectId)?.subjectId ?? null,
      priority: 80 + Math.min(list.length, 10),
      actions: [{ kind: "lab", label: "S'entraîner dans le laboratoire", href: "/code" }],
    });
  }

  // ── Plusieurs tentatives nécessaires ──
  const retryBySubject = new Map<string, CoachAnswer[]>();
  for (const a of answers) if (a.tries >= 3) retryBySubject.set(a.subjectName ?? "", [...(retryBySubject.get(a.subjectName ?? "") ?? []), a]);
  for (const [name, list] of retryBySubject) {
    if (list.length < 3) continue;
    out.push({
      key: `tries:${name}`,
      category: "ADVICE",
      tone: "neutral",
      title: `Plusieurs essais nécessaires en ${subjectLabel(name || null)}`,
      text: `${list.length} de vos réponses ont demandé au moins 3 tentatives. Avant de répondre, prenez le temps de relire la consigne et la notion concernée.`,
      evidence: [{ label: "Réponses à 3 essais ou plus", value: String(list.length) }],
      confidence: "moyenne",
      subjectId: list[0].subjectId,
      priority: 50,
      actions: [],
    });
  }

  // ── Évolution dans le temps, par matière ──
  const bySubject = new Map<string, CoachAttempt[]>();
  for (const a of graded) bySubject.set(a.subjectId ?? "", [...(bySubject.get(a.subjectId ?? "") ?? []), a]);
  for (const [sid, list] of bySubject) {
    if (list.length < TREND_MIN_ATTEMPTS) continue;
    const recent = list.slice(-3);
    const before = list.slice(Math.max(0, list.length - 6), -3);
    if (before.length < 2) continue;
    const delta = avg(recent.map((a) => a.ratio!)) - avg(before.map((a) => a.ratio!));
    const name = list[0].subjectName;
    const evidence = [{ label: "Avant", value: pct(avg(before.map((a) => a.ratio!))) }, { label: "Récemment", value: pct(avg(recent.map((a) => a.ratio!))) }, { label: "Exercices comparés", value: String(before.length + recent.length) }];
    if (delta >= TREND_DELTA) {
      out.push({
        key: `progress:${sid}`,
        category: "PROGRESS",
        tone: "positive",
        title: `Vous progressez en ${subjectLabel(name)}`,
        text: `Votre résultat moyen est passé de ${pct(avg(before.map((a) => a.ratio!)))} à ${pct(avg(recent.map((a) => a.ratio!)))}. Vous pouvez maintenant essayer des exercices plus difficiles.`,
        evidence,
        confidence: list.length >= 6 ? "bonne" : "moyenne",
        subjectId: sid || null,
        priority: 60,
        actions: [{ kind: "new_series", label: "Série plus difficile", href: href.series({ subjectId: sid || null, documentId: list.at(-1)!.documentId, subject: name ?? undefined, difficulty: "difficile", count: 5 }) }],
      });
    } else if (delta <= -TREND_DELTA) {
      out.push({
        key: `decline:${sid}`,
        category: "ALERT",
        tone: "warning",
        title: `Vos résultats baissent en ${subjectLabel(name)}`,
        text: `Votre résultat moyen est passé de ${pct(avg(before.map((a) => a.ratio!)))} à ${pct(avg(recent.map((a) => a.ratio!)))} sur vos derniers exercices. Un retour sur le cours peut aider avant de continuer.`,
        evidence,
        confidence: list.length >= 6 ? "bonne" : "moyenne",
        subjectId: sid || null,
        priority: 85,
        actions: list.at(-1)!.documentId && sid ? [{ kind: "open_course", label: "Reprendre le cours", href: href.course(sid, list.at(-1)!.documentId!) }] : [],
      });
    }
  }

  // ── Exercices échoués : à refaire (dernier résultat insuffisant) ──
  const lastByExercise = new Map<string, CoachAttempt>();
  for (const a of graded) if (a.exerciseId) lastByExercise.set(a.exerciseId, a);
  const failed = [...lastByExercise.values()].filter((a) => a.ratio! < 0.5).sort((a, b) => (b.finishedAt ?? b.startedAt).getTime() - (a.finishedAt ?? a.startedAt).getTime()).slice(0, 2);
  for (const a of failed) {
    out.push({
      key: `retry:${a.exerciseId}`,
      category: "ACTIVITY",
      tone: "neutral",
      title: `Refaire « ${a.title} »`,
      text: `Votre dernier résultat sur cet exercice est de ${pct(a.ratio!)}. Le refaire après avoir relu les corrections est le meilleur moyen de consolider.`,
      evidence: [{ label: "Dernier résultat", value: pct(a.ratio!) }],
      confidence: "bonne",
      subjectId: a.subjectId,
      priority: 65,
      actions: [{ kind: "retry_exercise", label: "Refaire l'exercice", href: href.exercise(a.subjectId, a.exerciseId!) }],
    });
  }

  // ── Demandes répétées d'indices ou d'explications ──
  const hintConcepts = new Map<string, CoachHint[]>();
  for (const h of hints) for (const c of h.conceptNames.length ? h.conceptNames.slice(0, 1) : [""]) hintConcepts.set(c, [...(hintConcepts.get(c) ?? []), h]);
  for (const [name, list] of hintConcepts) {
    if (!name || list.length < HINTS_MIN || uniq(list.map((h) => h.attemptId)).length < 2) continue;
    const info = concepts.find((c) => c.name === name && c.documentId);
    out.push({
      key: `hints:${name}`,
      category: "ADVICE",
      tone: "neutral",
      title: `Beaucoup d'aide demandée sur « ${name} »`,
      text: `Vous avez sollicité ${list.length} fois des indices ou des explications sur « ${name} », en ${uniq(list.map((h) => h.attemptId)).length} sessions. Relire cette partie du cours avant de refaire des exercices vous fera gagner du temps.`,
      evidence: [{ label: "Demandes d'aide", value: String(list.length) }, { label: "Sessions", value: String(uniq(list.map((h) => h.attemptId)).length) }],
      confidence: "moyenne",
      subjectId: list[0].subjectId,
      priority: 60,
      actions: info?.documentId && list[0].subjectId ? [{ kind: "open_course", label: "Relire le cours", href: href.course(list[0].subjectId, info.documentId) }] : [],
    });
  }

  // ── Régularité et objectif hebdomadaire ──
  const lastActivity = attempts.reduce<Date | null>((m, a) => (!m || a.updatedAt > m ? a.updatedAt : m), null);
  if (lastActivity && attempts.length >= 3) {
    const gap = Math.floor((now.getTime() - lastActivity.getTime()) / DAY);
    if (gap >= INACTIVE_AFTER_DAYS) {
      out.push({
        key: "regularity:gap",
        category: "ALERT",
        tone: "warning",
        title: "Une pause dans votre travail",
        text: `Vous n'avez pas travaillé d'exercice depuis ${gap} jours. Une courte série régulière vaut mieux qu'une longue session isolée.`,
        evidence: [{ label: "Dernière activité", value: `il y a ${gap} jours` }, { label: "Jours actifs sur 14", value: String(days14.size) }],
        confidence: "bonne",
        subjectId: null,
        priority: 55,
        actions: [{ kind: "new_series", label: "Reprendre avec une série courte", href: href.series({ count: 5 }) }],
      });
    }
  }
  if (input.weeklyGoal > 0) {
    const start = weekStart(now);
    const done = graded.filter((a) => (a.finishedAt ?? a.startedAt) >= start).length;
    const elapsed = Math.floor((now.getTime() - start.getTime()) / DAY) + 1;
    const evidence = [{ label: "Terminés cette semaine", value: `${done} sur ${input.weeklyGoal}` }];
    if (done >= input.weeklyGoal) {
      out.push({ key: "goal:reached", category: "PROGRESS", tone: "positive", title: "Objectif de la semaine atteint", text: `Vous avez terminé ${done} exercice(s) cette semaine, pour un objectif de ${input.weeklyGoal}.`, evidence, confidence: "bonne", subjectId: null, priority: 45, actions: [] });
    } else if (elapsed >= 4) {
      out.push({ key: "goal:behind", category: "ACTIVITY", tone: "neutral", title: "Objectif de la semaine", text: `Il vous reste ${input.weeklyGoal - done} exercice(s) à terminer cette semaine pour atteindre votre objectif de ${input.weeklyGoal}.`, evidence, confidence: "bonne", subjectId: null, priority: 58, actions: [{ kind: "new_series", label: "Commencer un exercice", href: href.series({ count: 5 }) }] });
    }
  }

  // ── Maîtrise : progression suggérée ou notion à confirmer ──
  const mastered = concepts.filter((c) => c.level >= MASTERED_LEVEL && c.confidence >= 0.5 && c.evidenceCount >= 4).sort((a, b) => b.evidenceCount - a.evidenceCount).slice(0, 2);
  for (const c of mastered) {
    out.push({
      key: `mastered:${c.id}`,
      category: "PROGRESS",
      tone: "positive",
      title: `Vous maîtrisez « ${c.name} »`,
      text: `Votre maîtrise estimée de « ${c.name} » (${c.subjectName}) est de ${pct(c.level)} d'après ${c.evidenceCount} réponses. Vous pouvez passer à des exercices plus complexes ou à un cas pratique complet.`,
      evidence: [{ label: "Maîtrise estimée", value: pct(c.level) }, { label: "Réponses analysées", value: String(c.evidenceCount) }],
      confidence: c.evidenceCount >= 8 ? "bonne" : "moyenne",
      subjectId: c.subjectId,
      priority: 40,
      actions: [{ kind: "new_series", label: "Exercice plus difficile", href: href.series({ subjectId: c.subjectId, documentId: c.documentId, conceptId: c.id, subject: c.subjectName, chapter: c.name, difficulty: "difficile", count: 4 }) }],
    });
  }
  const unconfirmed = concepts.filter((c) => c.evidenceCount >= 1 && c.evidenceCount < 3 && c.level >= 0.5).slice(0, 2);
  for (const c of unconfirmed) {
    out.push({
      key: `unconfirmed:${c.id}`,
      category: "ALERT",
      tone: "neutral",
      title: `« ${c.name} » : pas encore assez pratiqué`,
      text: `Vous n'avez répondu qu'à ${c.evidenceCount} question(s) sur « ${c.name} » : c'est trop peu pour la considérer comme maîtrisée. Un court test permettrait de le vérifier.`,
      evidence: [{ label: "Réponses analysées", value: String(c.evidenceCount) }, { label: "Confiance de l'estimation", value: pct(c.confidence) }],
      confidence: "faible",
      subjectId: c.subjectId,
      priority: 30,
      actions: [{ kind: "test", label: "Faire un test", href: href.series({ subjectId: c.subjectId, documentId: c.documentId, conceptId: c.id, subject: c.subjectName, chapter: c.name, count: 4, mode: "examen" }) }],
    });
  }

  const seen = new Set<string>();
  const insights = out
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);
  return { status: "ok", insights, summary, missing: null };
}
