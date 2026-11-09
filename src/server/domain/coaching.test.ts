import { describe, expect, it } from "vitest";
import { buildInsights, weekStart, type CoachAnswer, type CoachAttempt, type CoachInput, type HrefBuilders } from "./coaching";

const href: HrefBuilders = {
  course: (s, d) => `/c/${s}/${d}`,
  attempt: (s, e, a) => `/a/${s}/${e}/${a}`,
  exercise: (s, e) => `/e/${s}/${e}`,
  series: (p) => `/s/${p.conceptId ?? p.subject ?? ""}/${p.difficulty ?? ""}`,
};
const NOW = new Date("2026-11-11T10:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
const attempt = (o: Partial<CoachAttempt> = {}): CoachAttempt => {
  const id = `t${++seq}`;
  return { id, exerciseId: `ex${seq}`, title: `Ex ${seq}`, subjectId: "s1", subjectName: "Algo", documentId: "d1", status: "GRADED", startedAt: daysAgo(3), updatedAt: daysAgo(3), finishedAt: daysAgo(3), ratio: 0.5, durationSec: 600, answered: 5, total: 5, ...o };
};
const answer = (attemptId: string, verdict: string, o: Partial<CoachAnswer> = {}): CoachAnswer => ({ attemptId, subjectId: "s1", subjectName: "Algo", conceptIds: ["c1"], conceptNames: ["Pointeurs"], verdict, tries: 1, ...o });
const base = (o: Partial<CoachInput> = {}): CoachInput => ({ attempts: [], answers: [], hints: [], errors: [], concepts: [], weeklyGoal: 0, now: NOW, ...o });
const keys = (i: CoachInput) => buildInsights(i, href).insights.map((x) => x.key);

describe("données insuffisantes", () => {
  it("le dit au lieu d'inventer une difficulté", () => {
    const a = attempt();
    const r = buildInsights(base({ attempts: [a], answers: [answer(a.id, "incorrect"), answer(a.id, "incorrect"), answer(a.id, "incorrect")] }), href);
    expect(r.status).toBe("insufficient");
    expect(r.missing).toContain("Pas encore assez de données");
    expect(r.insights.filter((i) => i.category === "ALERT")).toHaveLength(0);
  });
  it("garde les exercices à reprendre, qui ne dépendent pas des statistiques", () => {
    const a = attempt({ status: "IN_PROGRESS", ratio: null, updatedAt: daysAgo(4), answered: 2, total: 6 });
    const r = buildInsights(base({ attempts: [a] }), href);
    expect(r.insights[0]).toMatchObject({ key: `resume:${a.id}`, category: "ACTIVITY" });
    expect(r.insights[0].actions[0].href).toBe(`/a/s1/${a.exerciseId}/${a.id}`);
  });
});

describe("difficulté persistante", () => {
  const sessions = () => [attempt({ ratio: 0.3 }), attempt({ ratio: 0.4 })];
  it("exige plusieurs réponses et plusieurs sessions : une seule session ne suffit pas", () => {
    const [a] = sessions();
    const r = keys(base({ attempts: [a, attempt()], answers: [answer(a.id, "incorrect"), answer(a.id, "incorrect"), answer(a.id, "incorrect"), answer(a.id, "incorrect"), answer(a.id, "incorrect"), answer(a.id, "incorrect")] }));
    expect(r.some((k) => k.startsWith("difficulty:"))).toBe(false);
  });
  it("signale une notion ratée sur deux sessions, avec ses preuves et le cours", () => {
    const [a, b] = sessions();
    const answers = [answer(a.id, "incorrect"), answer(a.id, "incorrect"), answer(b.id, "incorrect"), answer(b.id, "partial"), answer(b.id, "correct"), answer(a.id, "correct", { conceptIds: ["c2"], conceptNames: ["Listes"] })];
    const r = buildInsights(base({ attempts: [a, b], answers, concepts: [{ id: "c1", name: "Pointeurs", subjectId: "s1", subjectName: "Algo", level: 0.2, confidence: 0.6, evidenceCount: 5, documentId: "d1" }] }), href);
    const d = r.insights.find((i) => i.key === "difficulty:c1")!;
    expect(d).toMatchObject({ category: "ALERT", tone: "warning" });
    expect(d.evidence.map((e) => e.label)).toContain("Sessions concernées");
    expect(d.actions.map((x) => x.kind)).toEqual(["open_course", "new_series"]);
  });
  it("ne signale pas une notion globalement réussie", () => {
    const [a, b] = sessions();
    const answers = [answer(a.id, "incorrect"), answer(a.id, "correct"), answer(b.id, "incorrect"), answer(b.id, "correct"), answer(b.id, "correct"), answer(a.id, "correct")];
    expect(keys(base({ attempts: [a, b], answers })).some((k) => k.startsWith("difficulty:"))).toBe(false);
  });
});

describe("évolution, aide demandée, régularité, objectifs", () => {
  const filler = (ids: string[]) => ids.map((id) => answer(id, "correct", { conceptIds: [], conceptNames: [] }));
  it("détecte une progression puis une baisse sur une matière", () => {
    const rising = [0.3, 0.35, 0.3, 0.7, 0.75, 0.8].map((ratio, i) => attempt({ ratio, finishedAt: daysAgo(12 - i) }));
    expect(keys(base({ attempts: rising, answers: filler(rising.map((a) => a.id)) }))).toContain("progress:s1");
    const falling = [0.8, 0.75, 0.8, 0.4, 0.35, 0.3].map((ratio, i) => attempt({ ratio, finishedAt: daysAgo(12 - i) }));
    expect(keys(base({ attempts: falling, answers: filler(falling.map((a) => a.id)) }))).toContain("decline:s1");
  });
  it("ne conclut pas à une évolution avec trop peu d'exercices", () => {
    const few = [0.2, 0.9, 0.9].map((ratio, i) => attempt({ ratio, finishedAt: daysAgo(5 - i) }));
    const k = keys(base({ attempts: few, answers: filler(few.map((a) => a.id)) }));
    expect(k.some((x) => x.startsWith("progress:") || x.startsWith("decline:"))).toBe(false);
  });
  it("relève les demandes d'aide répétées sur plusieurs sessions", () => {
    const [a, b] = [attempt(), attempt()];
    const hints = [a, a, a, b, b].map((x) => ({ attemptId: x.id, subjectId: "s1", conceptNames: ["Récursivité"] }));
    const r = buildInsights(base({ attempts: [a, b], answers: filler([a.id, b.id, a.id, b.id, a.id, b.id]), hints, concepts: [{ id: "c9", name: "Récursivité", subjectId: "s1", subjectName: "Algo", level: 0.5, confidence: 0.5, evidenceCount: 3, documentId: "d1" }] }), href);
    expect(r.insights.find((i) => i.key === "hints:Récursivité")?.actions[0].kind).toBe("open_course");
  });
  it("signale une longue pause", () => {
    const old = [attempt({ updatedAt: daysAgo(20), finishedAt: daysAgo(20) }), attempt({ updatedAt: daysAgo(19), finishedAt: daysAgo(19) }), attempt({ updatedAt: daysAgo(9), finishedAt: daysAgo(9) })];
    expect(keys(base({ attempts: old, answers: filler(old.map((a) => a.id).concat(old.map((a) => a.id))) }))).toContain("regularity:gap");
  });
  it("suit l'objectif hebdomadaire", () => {
    const monday = weekStart(NOW);
    const done = [attempt({ finishedAt: new Date(monday.getTime() + 3_600_000), ratio: 0.8 }), attempt({ finishedAt: new Date(monday.getTime() + 7_200_000), ratio: 0.8 })];
    const answers = filler(done.map((a) => a.id).concat(done.map((a) => a.id)).concat(done.map((a) => a.id)));
    expect(keys(base({ attempts: done, answers, weeklyGoal: 2 }))).toContain("goal:reached");
    expect(keys(base({ attempts: done, answers, weeklyGoal: 5, now: new Date(monday.getTime() + 5 * 86_400_000) }))).toContain("goal:behind");
  });
  it("propose de confirmer une notion peu pratiquée, et de monter en difficulté sur une notion maîtrisée", () => {
    const att = [attempt(), attempt()];
    const concepts = [
      { id: "m", name: "SQL", subjectId: "s1", subjectName: "BD", level: 0.9, confidence: 0.8, evidenceCount: 9, documentId: "d1" },
      { id: "u", name: "Merise", subjectId: "s1", subjectName: "BD", level: 0.8, confidence: 0.3, evidenceCount: 2, documentId: null },
    ];
    const k = keys(base({ attempts: att, answers: filler(att.map((a) => a.id).concat(att.map((a) => a.id)).concat(att.map((a) => a.id))), concepts }));
    expect(k).toContain("mastered:m");
    expect(k).toContain("unconfirmed:u");
  });
});

describe("classement", () => {
  it("place les alertes avant les progressions, sans doublon", () => {
    const [a, b] = [attempt({ ratio: 0.3 }), attempt({ ratio: 0.3 })];
    const answers = [answer(a.id, "incorrect"), answer(a.id, "incorrect"), answer(b.id, "incorrect"), answer(b.id, "incorrect"), answer(a.id, "correct", { conceptIds: [] }), answer(b.id, "correct", { conceptIds: [] })];
    const r = buildInsights(base({ attempts: [a, b], answers, concepts: [{ id: "m", name: "SQL", subjectId: "s1", subjectName: "BD", level: 0.9, confidence: 0.8, evidenceCount: 9, documentId: null }] }), href);
    const order = r.insights.map((i) => i.category);
    expect(order.indexOf("ALERT")).toBeLessThan(order.indexOf("PROGRESS"));
    expect(new Set(r.insights.map((i) => i.key)).size).toBe(r.insights.length);
  });
});
