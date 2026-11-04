import { describe, expect, it } from "vitest";
import { progressionState, type ProgressEvidence } from "./progression";
import { recurringDifficulties, skillForKind, type SkillObservationView } from "./skills";

const NOW = new Date("2026-11-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000);
const ev = (score: number, days: number, source: string, context = "answer", weight = 1): ProgressEvidence => ({ score, weight, at: daysAgo(days), source, context });

describe("états de progression", () => {
  it("notion jamais évaluée", () => {
    expect(progressionState([], { now: NOW })).toMatchObject({ state: "NOT_ASSESSED", attempts: 0 });
  });

  it("une seule réponse ne suffit jamais : ni maîtrise, ni fragilité affirmée", () => {
    expect(progressionState([ev(1, 0, "a:1")], { now: NOW }).state).toBe("TO_DISCOVER");
    expect(progressionState([ev(0, 0, "a:1")], { now: NOW }).state).toBe("TO_DISCOVER");
  });

  it("notion mal comprise : échecs répétés sur plusieurs tentatives → fragile", () => {
    const r = progressionState([ev(0, 1, "a:1"), ev(0.2, 2, "a:2"), ev(0, 3, "a:3")], { now: NOW });
    expect(r.state).toBe("FRAGILE");
    expect(r.failures).toBe(3);
  });

  it("progrès sans réussite assez sûre → en cours d'acquisition", () => {
    const r = progressionState([ev(0, 6, "a:1"), ev(1, 4, "a:2"), ev(0.6, 1, "a:3")], { now: NOW });
    expect(r.state).toBe("ACQUIRING");
  });

  it("plusieurs réussites sûres → maîtrisée, mais pas encore confirmée", () => {
    const r = progressionState([ev(1, 1, "a:1"), ev(1, 1, "a:2"), ev(1, 0, "a:3"), ev(1, 0, "a:3")], { now: NOW });
    expect(r.state).toBe("MASTERED");
    expect(r.reasons.join(" ")).toContain("pas encore assez variée");
  });

  it("maîtrise confirmée : réussites variées, plusieurs tentatives, plusieurs jours", () => {
    const r = progressionState([ev(1, 10, "answer:1", "answer"), ev(1, 7, "answer:2", "answer", 1.3), ev(1, 3, "lab:1", "lab"), ev(1, 1, "answer:3", "answer")], { now: NOW });
    expect(r.state).toBe("CONFIRMED");
  });

  it("beaucoup d'indices empêchent la confirmation (réussite sans maîtrise réelle)", () => {
    const list = [ev(1, 10, "answer:1"), ev(1, 7, "answer:2", "answer", 1.3), ev(1, 3, "lab:1", "lab"), ev(1, 1, "answer:3")];
    expect(progressionState(list, { now: NOW, hintsUsed: 9 }).state).toBe("MASTERED");
  });

  it("anciennement maîtrisée : reste maîtrisée mais à revérifier, jamais « confirmée »", () => {
    const r = progressionState([ev(1, 90, "answer:1"), ev(1, 88, "answer:2"), ev(1, 80, "lab:1", "lab"), ev(1, 70, "answer:3")], { now: NOW });
    expect(r.state).toBe("MASTERED");
    expect(r.needsRecheck).toBe(true);
    expect(r.reasons.join(" ")).toContain("à vérifier de nouveau");
  });

  it("erreurs répétées sur la notion : fragile malgré un niveau moyen", () => {
    const list = [ev(1, 5, "a:1"), ev(0, 4, "a:2"), ev(1, 3, "a:3"), ev(0, 2, "a:4")];
    expect(progressionState(list, { now: NOW, repeatedErrors: 0 }).state).toBe("ACQUIRING");
    expect(progressionState(list, { now: NOW, repeatedErrors: 3 }).state).toBe("FRAGILE");
  });
});

describe("compétences communes aux langages", () => {
  const obs = (skill: string, language: string | null, activity: string, days: number): SkillObservationView => ({ skill, language, activity, at: daysAgo(days) });

  it("rapproche les constats des outils d'une compétence abstraite", () => {
    expect(skillForKind("sql_where_having")?.key).toBe("agregation-filtrage");
    expect(skillForKind("timeout")?.key).toBe("conditions-arret");
    expect(skillForKind("unknown_kind")).toBeNull();
  });

  it("8. même difficulté dans plusieurs langages : signalée comme hypothèse à vérifier, avec les différences de langage", () => {
    const list = [obs("valeurs-nulles", "python", "CODE", 6), obs("valeurs-nulles", "javascript", "CODE", 3), obs("valeurs-nulles", "sql", "SQL", 1)];
    const [i] = recurringDifficulties(list, NOW);
    expect(i).toMatchObject({ skill: "valeurs-nulles", occurrences: 3, needsVerification: true });
    expect(i.languages.sort()).toEqual(["javascript", "python", "sql"]);
    expect(i.statement).toContain("À vérifier");
    expect(i.note).toContain("langage");
  });

  it("pas de difficulté récurrente avec moins de 3 occurrences, un seul jour, ou des observations anciennes", () => {
    expect(recurringDifficulties([obs("cas-limites", "python", "CODE", 1), obs("cas-limites", "python", "CODE", 1)], NOW)).toEqual([]);
    expect(recurringDifficulties([obs("cas-limites", "python", "CODE", 0), obs("cas-limites", "python", "CODE", 0), obs("cas-limites", "python", "CODE", 0)], NOW)).toEqual([]);
    expect(recurringDifficulties([obs("cas-limites", "python", "CODE", 80), obs("cas-limites", "python", "CODE", 70), obs("cas-limites", "python", "CODE", 60)], NOW)).toEqual([]);
  });

  it("une récurrence dans un seul langage n'est pas présentée comme transversale", () => {
    const [i] = recurringDifficulties([obs("cas-limites", "python", "CODE", 5), obs("cas-limites", "python", "CODE", 3), obs("cas-limites", "python", "CODE", 1)], NOW);
    expect(i.statement).toContain("se répète");
    expect(i.statement).not.toContain("dans PYTHON, ");
  });
});
