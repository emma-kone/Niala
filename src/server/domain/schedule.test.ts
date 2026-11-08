import { describe, expect, it } from "vitest";
import { buildSuggestions, pickHighlight, type CourseToday } from "./dashboard";
import { BREAKS, DAY_END, DAY_START, addDays, breakOverlap, classifyOccurrence, diffImport, expandEvents, findConflicts, isoWeek, mondayOf, occurrenceDates, parseTime, validateTimes, weekLetter, weekday, type ExistingCourse, type ScheduleEventRecord, type ScheduleOverrideRecord } from "./schedule";

const event = (over: Partial<ScheduleEventRecord> = {}): ScheduleEventRecord => ({ id: "e1", subjectId: null, title: "Algo", kind: "COURSE", date: "2026-11-02", startMinutes: 480, endMinutes: 570, recurrence: "WEEKLY", until: null, weekPattern: "ALL", room: null, teacher: null, groupName: null, description: null, importId: null, confidence: null, ...over });
const override = (over: Partial<ScheduleOverrideRecord>): ScheduleOverrideRecord => ({ eventId: "e1", date: "2026-11-09", cancelled: false, newDate: null, startMinutes: null, endMinutes: null, subjectId: null, title: null, room: null, teacher: null, description: null, ...over });

describe("structure de la journée", () => {
  it("couvre 7 h 30 à 18 h 30, pauses de 10 h et de midi", () => {
    expect([DAY_START, DAY_END]).toEqual([450, 1110]);
    expect(BREAKS.map((b) => [b.start, b.end])).toEqual([[600, 615], [720, 840]]);
  });
  it("accepte 30 min, 45 min, 1 h 30 et 2 h, en minutes précises", () => {
    for (const [s, e] of [[450, 480], [615, 660], [480, 570], [840, 960]]) expect(validateTimes(s, e)).toBeNull();
  });
  it("refuse hors de la grille, à l'envers ou trop court", () => {
    expect(validateTimes(420, 480)).toContain("07:30");
    expect(validateTimes(1080, 1140)).toContain("18:30");
    expect(validateTimes(600, 540)).toContain("fin");
    expect(validateTimes(480, 490)).toContain("15");
  });
  it("détecte une pause touchée, pas un cours qui s'arrête juste avant", () => {
    expect(breakOverlap(570, 600)).toBeNull();
    expect(breakOverlap(615, 660)).toBeNull();
    expect(breakOverlap(590, 610)?.label).toBe("Pause");
    expect(breakOverlap(700, 730)?.label).toBe("Pause déjeuner");
    expect(breakOverlap(840, 900)).toBeNull();
  });
  it("lit les heures écrites de plusieurs façons", () => {
    expect(["8:30", "08h30", "8h", "14 h 15", "9"].map(parseTime)).toEqual([510, 510, 480, 855, 540]);
    expect(["", "abc", "25:00", null].map(parseTime)).toEqual([null, null, null, null]);
  });
});

describe("dates", () => {
  it("calcule jour, lundi et semaine ISO sans dépendre du fuseau", () => {
    expect(weekday("2026-11-08")).toBe(7);
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoWeek("2027-01-01")).toBe(53);
  });
  it("traverse le changement d'heure sans décalage de jour", () => {
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(occurrenceDates(event({ date: "2026-10-19" }), "2026-10-19", "2026-11-02")).toEqual(["2026-10-19", "2026-10-26", "2026-11-02"]);
  });
});

describe("récurrences", () => {
  it("répète chaque semaine, à partir de la bonne séance et jusqu'à la date de fin", () => {
    expect(occurrenceDates(event(), "2026-11-10", "2026-11-30")).toEqual(["2026-11-16", "2026-11-23", "2026-11-30"]);
    expect(occurrenceDates(event({ until: "2026-11-10" }), "2026-11-01", "2026-12-31")).toEqual(["2026-11-02", "2026-11-09"]);
  });
  it("un événement ponctuel n'apparaît qu'une fois", () => {
    expect(occurrenceDates(event({ recurrence: "NONE" }), "2026-11-01", "2026-12-31")).toEqual(["2026-11-02"]);
  });
  it("semaines A/B en alternance, convention réversible", () => {
    const a = occurrenceDates(event({ weekPattern: "A" }), "2026-11-02", "2026-11-30");
    const b = occurrenceDates(event({ weekPattern: "B" }), "2026-11-02", "2026-11-30");
    expect(a.length + b.length).toBe(5);
    expect(a.every((d) => weekLetter(d) === "A")).toBe(true);
    expect(occurrenceDates(event({ weekPattern: "A" }), "2026-11-02", "2026-11-30", true)).toEqual(b);
  });
  it("modifie une seule séance sans toucher la série", () => {
    const out = expandEvents([event()], [override({ startMinutes: 900, endMinutes: 960, room: "B12" })], "2026-11-02", "2026-11-16");
    expect(out.map((o) => [o.date, o.startMinutes, o.room])).toEqual([["2026-11-02", 480, null], ["2026-11-09", 900, "B12"], ["2026-11-16", 480, null]]);
  });
  it("annule ou déplace une séance, y compris depuis une autre semaine", () => {
    expect(expandEvents([event()], [override({ cancelled: true })], "2026-11-09", "2026-11-09")).toEqual([]);
    const moved = expandEvents([event()], [override({ newDate: "2026-11-20" })], "2026-11-17", "2026-11-22");
    expect(moved.map((o) => [o.originalDate, o.date])).toEqual([["2026-11-09", "2026-11-20"], ["2026-11-16", "2026-11-16"]].filter(([, d]) => d >= "2026-11-17"));
  });
});

describe("chevauchements", () => {
  const others = [{ key: "a", date: "2026-11-02", title: "A", startMinutes: 480, endMinutes: 570 }];
  it("signale un chevauchement le même jour seulement", () => {
    expect(findConflicts({ date: "2026-11-02", startMinutes: 540, endMinutes: 600 }, others)).toHaveLength(1);
    expect(findConflicts({ date: "2026-11-03", startMinutes: 540, endMinutes: 600 }, others)).toHaveLength(0);
  });
  it("deux cours qui se suivent ne se chevauchent pas", () => {
    expect(findConflicts({ date: "2026-11-02", startMinutes: 570, endMinutes: 600 }, others)).toHaveLength(0);
  });
  it("ignore le cours en cours de modification", () => {
    expect(findConflicts({ date: "2026-11-02", startMinutes: 480, endMinutes: 570 }, others, "a")).toHaveLength(0);
  });
  it("distingue passé, en cours et à venir", () => {
    const o = { date: "2026-11-02", startMinutes: 480, endMinutes: 570 };
    expect(classifyOccurrence(o, "2026-11-02", 500)).toBe("current");
    expect(classifyOccurrence(o, "2026-11-02", 570)).toBe("past");
    expect(classifyOccurrence(o, "2026-11-02", 470)).toBe("upcoming");
    expect(classifyOccurrence(o, "2026-11-03", 0)).toBe("past");
  });
});

describe("imports successifs", () => {
  const existing = (over: Partial<ExistingCourse>): ExistingCourse => ({ id: "x", title: "Algo", date: "2026-11-02", startMinutes: 480, endMinutes: 570, room: null, teacher: null, weekPattern: "ALL", importId: "i1", ...over });
  const draft = (over = {}) => ({ title: "algo", day: 1, startMinutes: 480, endMinutes: 570, room: null, teacher: null, weekPattern: "ALL" as const, ...over });

  it("reconnaît un cours identique malgré casse et accents", () => {
    expect(diffImport([draft()], [existing({})]).items[0].status).toBe("identique");
  });
  it("repère un horaire, une salle et un cours nouveau", () => {
    expect(diffImport([draft({ startMinutes: 510, endMinutes: 600 })], [existing({})]).items[0]).toMatchObject({ status: "modifie", changes: ["horaire"] });
    expect(diffImport([draft({ room: "A1" })], [existing({})]).items[0]).toMatchObject({ status: "modifie", changes: ["salle"] });
    expect(diffImport([draft({ title: "Réseaux" })], [existing({})]).items[0].status).toBe("nouveau");
  });
  it("liste les cours importés disparus, jamais ceux saisis à la main", () => {
    expect(diffImport([], [existing({ id: "imp" }), existing({ id: "man", importId: null })]).removed.map((r) => r.id)).toEqual(["imp"]);
  });
});

describe("tableau de bord", () => {
  const course = (over: Partial<CourseToday> = {}): CourseToday => ({ key: "k", date: "2026-11-09", title: "Algo", startMinutes: 600, endMinutes: 660, room: null, subjectId: "s1", subjectName: "Algo", ...over });
  const base = { date: "2026-11-09", nowMinutes: 500, today: [] as CourseToday[], resume: null, recommendation: null, mastery: null, hasSubjects: true };

  it("priorise le cours en cours, puis imminent, puis la reprise", () => {
    expect(pickHighlight({ ...base, nowMinutes: 620, today: [course()], resume: { title: "R", href: "/r" } }).kind).toBe("course_now");
    expect(pickHighlight({ ...base, today: [course()], resume: { title: "R", href: "/r" } }).kind).toBe("course_soon");
    expect(pickHighlight({ ...base, today: [course({ startMinutes: 900, endMinutes: 960 })], resume: { title: "R", href: "/r" } }).kind).toBe("resume");
    expect(pickHighlight({ ...base, today: [course({ startMinutes: 900, endMinutes: 960 })] }).kind).toBe("course_later");
  });
  it("ignore les cours de demain et n'invente rien sans donnée", () => {
    expect(pickHighlight({ ...base, today: [course({ date: "2026-11-10" })] }).kind).toBe("start");
    expect(pickHighlight({ ...base, hasSubjects: false }).title).toContain("première matière");
  });
  const inputs = { date: "2026-11-09", nowMinutes: 500, upcoming: [] as CourseToday[], weakConcepts: [], recentDocuments: [], newDocuments: [], resume: null, recommendations: [], highlight: pickHighlight(base) };
  it("relie une notion fragile au prochain cours de la matière", () => {
    const out = buildSuggestions({ ...inputs, upcoming: [course()], weakConcepts: [{ name: "Récursivité", subjectId: "s1", level: 0.2 }] });
    expect(out[0]).toMatchObject({ kind: "before_course", title: "Revoir « Récursivité »" });
    expect(out[0].text).toContain("10:00");
  });
  it("sans donnée réelle, ne propose rien", () => {
    expect(buildSuggestions(inputs)).toEqual([]);
  });
  it("ne répète pas la recommandation déjà mise en avant", () => {
    const recommendations = [{ id: "r1", title: "T", text: "X" }];
    const highlight = pickHighlight({ ...base, recommendation: recommendations[0] });
    expect(buildSuggestions({ ...inputs, recommendations, highlight })).toEqual([]);
  });
});
