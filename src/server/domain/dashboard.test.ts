import { describe, expect, it } from "vitest";
import { buildDayView, referenceDate, type CourseToday } from "./dashboard";

const course = (date: string, startMinutes: number, endMinutes: number, title = "Java EE"): CourseToday => ({ key: `${title}:${date}:${startMinutes}`, date, title, startMinutes, endMinutes, room: null, subjectId: "s1", subjectName: title });

const SUNDAY = "2026-11-08";
const MONDAY = "2026-11-09";
const TUESDAY = "2026-11-10";
const view = (date: string, nowMinutes: number, courses: CourseToday[], schedule: "ok" | "empty" | "error" = "ok") => buildDayView({ date, nowMinutes, courses, schedule });

describe("journée de référence", () => {
  it("bascule sur le lendemain à 19 h précises", () => {
    expect(referenceDate(SUNDAY, 18 * 60 + 59)).toBe(SUNDAY);
    expect(referenceDate(SUNDAY, 19 * 60)).toBe(MONDAY);
    expect(referenceDate(MONDAY, 19 * 60)).toBe(TUESDAY);
  });

  it("franchit les fins de mois et d'année", () => {
    expect(referenceDate("2026-11-30", 19 * 60)).toBe("2026-12-01");
    expect(referenceDate("2026-12-31", 23 * 60)).toBe("2027-01-01");
  });

  it("garde la date réelle distincte de la journée présentée", () => {
    const v = view(SUNDAY, 19 * 60, [course(MONDAY, 615, 765)]);
    expect(v.date).toBe(SUNDAY);
    expect(v.reference).toBe(MONDAY);
    expect(v.isTomorrow).toBe(true);
    expect(v.label).toBe("Demain");
  });
});

describe("cours de la journée", () => {
  const monday = [course(MONDAY, 615, 765, "Java EE"), course(MONDAY, 450, 600, "UML")];

  it("avant 19 h : les cours du jour seulement, dans l'ordre chronologique", () => {
    const v = view(MONDAY, 480, [...monday, course(TUESDAY, 450, 600, "AGL")]);
    expect(v.courses.map((c) => c.title)).toEqual(["UML", "Java EE"]);
    expect(v.label).toBe("Aujourd'hui");
  });

  it("après 19 h : les cours du lendemain, tous à venir", () => {
    const v = view(MONDAY, 19 * 60 + 30, [...monday, course(TUESDAY, 450, 600, "AGL")]);
    expect(v.courses.map((c) => c.title)).toEqual(["AGL"]);
    expect(v.courses[0].phase).toBe("upcoming");
  });

  it("distingue cours terminé, en cours et à venir", () => {
    const phases = view(MONDAY, 620, monday).courses.map((c) => c.phase);
    expect(phases).toEqual(["done", "current"]);
    expect(view(MONDAY, 400, monday).courses.map((c) => c.phase)).toEqual(["upcoming", "upcoming"]);
  });

  it("un cours se terminant à l'instant présent est terminé", () => {
    expect(view(MONDAY, 600, monday).courses[0].phase).toBe("done");
  });

  it("aucun cours ce jour : état vide, avec le prochain cours", () => {
    const v = view(SUNDAY, 600, monday);
    expect(v.state).toBe("none");
    expect(v.courses).toEqual([]);
    expect(v.next?.title).toBe("UML");
  });

  it("tous les cours terminés avant 19 h : propose le prochain", () => {
    const v = view(MONDAY, 18 * 60, [...monday, course(TUESDAY, 450, 600, "AGL")]);
    expect(v.state).toBe("finished");
    expect(v.courses).toHaveLength(2);
    expect(v.next?.title).toBe("AGL");
  });

  it("plus aucun cours à venir : pas de prochain cours inventé", () => {
    expect(view(MONDAY, 18 * 60, monday).next).toBeNull();
  });

  it("sans emploi du temps importé : invite à l'import", () => {
    expect(view(MONDAY, 600, [], "empty").state).toBe("no_schedule");
  });

  it("agenda en erreur : jamais présenté comme une journée sans cours", () => {
    expect(view(MONDAY, 600, [], "error").state).toBe("unavailable");
  });

  it("n'annonce jamais un état vide quand des cours existent", () => {
    expect(view(MONDAY, 480, monday, "error").state).toBe("active");
  });
});
