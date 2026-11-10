// Agenda réorganisé : emplois du temps créés à la main, cours et pauses rattachés à un emploi du temps, tâches à heure précise.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";
import { dayStructure, timeSlots } from "@/server/domain/day-structure";
import { dueReminders } from "@/server/domain/academic";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let db: Ctx["db"];
let agenda: typeof import("./agenda");
let imports: typeof import("./import");
let tasks: typeof import("./tasks");
let storageDir: string;
let U: string;
let V: string;
const MONDAY = "2026-11-09";
const SUNDAY = "2026-11-15";

beforeAll(async () => {
  storageDir = mkdtempSync(path.join(tmpdir(), "niala-agenda-"));
  process.env.STORAGE_DIR = storageDir;
  ctx = await startTestDb();
  db = ctx.db;
  agenda = await import("./agenda");
  imports = await import("./import");
  tasks = await import("./tasks");
  U = (await db.user.create({ data: { email: "edt@test.local", passwordHash: "x", settings: { create: {} } } })).id;
  V = (await db.user.create({ data: { email: "autre-edt@test.local", passwordHash: "x", settings: { create: {} } } })).id;
});

afterAll(async () => {
  await ctx?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

describe("structure d'une journée (aucun horaire imposé)", () => {
  it("déduit cours, pauses et périodes libres des horaires réels", () => {
    const segs = dayStructure(
      [{ startMinutes: 7 * 60 + 30, endMinutes: 9 * 60 + 30, title: "Réseaux" }, { startMinutes: 9 * 60 + 45, endMinutes: 11 * 60 + 45, title: "Algèbre" }, { startMinutes: 14 * 60, endMinutes: 16 * 60, title: "Java" }],
      [{ startMinutes: 12 * 60, endMinutes: 13 * 60 + 30, label: "Déjeuner" }],
    );
    expect(segs.map((s) => [s.kind, s.startMinutes, s.endMinutes])).toEqual([
      ["course", 450, 570], ["free", 570, 585], ["course", 585, 705], ["free", 705, 720], ["break", 720, 810], ["free", 810, 840], ["course", 840, 960],
    ]);
  });
  it("un cours l'emporte sur une pause qui le chevauche, les créneaux distincts sont listés", () => {
    const segs = dayStructure([{ startMinutes: 600, endMinutes: 720, title: "TP" }], [{ startMinutes: 690, endMinutes: 780, label: "Pause" }]);
    expect(segs.map((s) => [s.kind, s.startMinutes, s.endMinutes])).toEqual([["course", 600, 720], ["break", 720, 780]]);
    expect(timeSlots([{ startMinutes: 480, endMinutes: 600 }, { startMinutes: 480, endMinutes: 600 }, { startMinutes: 615, endMinutes: 735 }])).toEqual([{ startMinutes: 480, endMinutes: 600, count: 2 }, { startMinutes: 615, endMinutes: 735, count: 1 }]);
  });
});

describe("emplois du temps créés à la main", () => {
  let A: string;
  let B: string;

  it("crée un emploi du temps vide, suivi, et y ajoute cours et pauses", async () => {
    A = (await imports.createSchedule(U, { label: "  Semestre   1 " })).id;
    const { imports: list, activeId } = await imports.listImports(U);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Semestre 1", source: "MANUAL" });
    expect(activeId).toBe(A);
    await agenda.createEvent(U, agenda.createEventSchema.parse({ title: "Algèbre", date: MONDAY, startMinutes: 450, endMinutes: 570, recurrence: "WEEKLY", scheduleId: A }));
    await tasks.createBreak(U, tasks.breakSchema.parse({ label: "Déjeuner", startMinutes: 720, endMinutes: 810, scheduleId: A }));
    const week = await agenda.listRange(U, MONDAY, SUNDAY, A);
    expect(week.occurrences.map((o) => [o.title, o.startMinutes])).toEqual([["Algèbre", 450]]);
    expect(week.breaks.map((b) => b.label)).toEqual(["Déjeuner"]);
  });

  it("deux emplois du temps restent séparés, même sur le même créneau", async () => {
    B = (await imports.createSchedule(U, { label: "Semestre 2", activate: false })).id;
    await agenda.createEvent(U, agenda.createEventSchema.parse({ title: "Réseaux", date: MONDAY, startMinutes: 450, endMinutes: 570, scheduleId: B }));
    expect((await agenda.listRange(U, MONDAY, SUNDAY, B)).occurrences.map((o) => o.title)).toEqual(["Réseaux"]);
    expect((await agenda.listRange(U, MONDAY, SUNDAY, A)).occurrences.map((o) => o.title)).toEqual(["Algèbre"]);
    // Sans précision, c'est l'emploi du temps suivi (A) qui est lu.
    expect((await agenda.listRange(U, MONDAY, SUNDAY)).occurrences.map((o) => o.title)).toEqual(["Algèbre"]);
  });

  it("signale un chevauchement seulement à l'intérieur d'un même emploi du temps", async () => {
    await expect(agenda.createEvent(U, agenda.createEventSchema.parse({ title: "Physique", date: MONDAY, startMinutes: 480, endMinutes: 540, scheduleId: A }))).rejects.toMatchObject({ status: 409 });
    await expect(agenda.createEvent(U, agenda.createEventSchema.parse({ title: "Midi", date: MONDAY, startMinutes: 730, endMinutes: 760, scheduleId: A }))).rejects.toMatchObject({ status: 409 });
  });

  it("modifie et supprime une pause", async () => {
    const b = (await tasks.listBreaks(U, A))[0]!;
    await tasks.updateBreak(U, b.id, { startMinutes: 735, label: "Pause de midi" });
    expect((await tasks.listBreaks(U, A))[0]).toMatchObject({ label: "Pause de midi", startMinutes: 735, endMinutes: 810 });
    await expect(tasks.updateBreak(U, b.id, { startMinutes: 900 })).rejects.toMatchObject({ status: 422 });
    await expect(tasks.updateBreak(V, b.id, { label: "x" })).rejects.toMatchObject({ status: 404 });
    await tasks.deleteBreak(U, b.id);
    expect(await tasks.listBreaks(U, A)).toHaveLength(0);
  });

  it("un autre étudiant ne peut ni lire ni remplir cet emploi du temps", async () => {
    await expect(agenda.listRange(V, MONDAY, SUNDAY, A)).rejects.toMatchObject({ status: 404 });
    await expect(agenda.createEvent(V, agenda.createEventSchema.parse({ title: "Intrus", date: MONDAY, startMinutes: 600, endMinutes: 660, scheduleId: A }))).rejects.toMatchObject({ status: 404 });
    await expect(tasks.createBreak(V, tasks.breakSchema.parse({ label: "Intrus", startMinutes: 600, endMinutes: 660, scheduleId: A }))).rejects.toMatchObject({ status: 404 });
  });

  it("un emploi du temps vide reste proposé ; sa suppression ne touche pas l'autre", async () => {
    const empty = (await imports.createSchedule(U, { label: "Vide", activate: false })).id;
    expect((await imports.listImports(U)).imports.map((i) => i.id)).toContain(empty);
    await imports.deleteSchedule(U, empty);
    await imports.deleteSchedule(U, B);
    expect((await imports.listImports(U)).imports.map((i) => i.label)).toEqual(["Semestre 1"]);
    await expect(imports.importFile(U, A)).rejects.toMatchObject({ status: 404 });
  });

  it("des cours saisis autrefois sans emploi du temps sont réunis dans « Mes cours », sans perte", async () => {
    const legacy = (await db.user.create({ data: { email: "ancien@test.local", passwordHash: "x", settings: { create: {} } } })).id;
    await db.scheduleEvent.create({ data: { userId: legacy, title: "Ancien cours", date: MONDAY, startMinutes: 600, endMinutes: 660, recurrence: "WEEKLY" } });
    await db.scheduleBreak.create({ data: { userId: legacy, label: "Pause", startMinutes: 660, endMinutes: 680 } });
    const { imports: list } = await imports.listImports(legacy);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Mes cours", source: "MANUAL", _count: { events: 1, breaks: 1 } });
    expect((await agenda.listRange(legacy, MONDAY, SUNDAY, list[0].id)).occurrences.map((o) => o.title)).toEqual(["Ancien cours"]);
  });
});

describe("tâches et rappels à heure précise", () => {
  it("une tâche à 18 h avec rappel « à l'heure prévue » se déclenche à 18 h, pas avant", async () => {
    const t = await tasks.createTask(U, tasks.createTaskSchema.parse({ title: "Faire l'exercice d'algorithmique", type: "EXERCICE", dueDate: "2026-11-10", dueMinutes: 18 * 60, estimatedMinutes: 45, reminderMinutes: [0], description: "Exercices 3 à 5" }));
    const input = { dueDate: t.dueDate, dueMinutes: t.dueMinutes, reminderMinutes: t.reminderMinutes as number[] };
    const noQuiet = { quietStart: 0, quietEnd: 0 };
    expect(dueReminders(input, "2026-11-10", 17 * 60 + 59, noQuiet, 60)).toEqual([]);
    expect(dueReminders(input, "2026-11-10", 18 * 60, noQuiet, 60)).toEqual([0]);
    expect(dueReminders(input, "2026-11-10", 18 * 60 + 30, noQuiet, 60)).toEqual([0]);
    expect(dueReminders(input, "2026-11-10", 19 * 60 + 5, noQuiet, 60)).toEqual([]);
    // Une heure tardive (23 h) n'est plus bloquée par des heures de tranquillité non réglables.
    expect(dueReminders({ ...input, dueMinutes: 23 * 60 }, "2026-11-10", 23 * 60, noQuiet, 60)).toEqual([0]);
  });

  it("marque une tâche terminée puis la rouvre ; elle passe des tâches à venir aux tâches effectuées", async () => {
    const t = await tasks.createTask(U, tasks.createTaskSchema.parse({ title: "Réviser le chapitre 2", dueDate: "2030-01-01", dueMinutes: 600, reminderMinutes: [0] }));
    await tasks.updateTask(U, t.id, { status: "TERMINE" });
    let row = (await tasks.listTasks(U, { date: "2026-11-10", minutes: 600 })).find((x) => x.id === t.id)!;
    expect(row.status).toBe("TERMINE");
    expect(row.completedAt).not.toBeNull();
    await tasks.updateTask(U, t.id, { status: "A_COMMENCER" });
    row = (await tasks.listTasks(U, { date: "2026-11-10", minutes: 600 })).find((x) => x.id === t.id)!;
    expect(row.status).toBe("A_COMMENCER");
    await tasks.deleteTask(U, t.id);
    await expect(tasks.deleteTask(U, t.id)).rejects.toMatchObject({ status: 404 });
  });

  it("les tâches ne sont jamais mêlées aux cours de l'emploi du temps", async () => {
    const { imports: list } = await imports.listImports(U);
    const week = await agenda.listRange(U, "2026-11-09", "2026-11-15", list[0].id);
    expect(week.occurrences.some((o) => o.title.includes("algorithmique"))).toBe(false);
  });
});

describe("anciens cours sans emploi du temps, avec un emploi du temps suivi", () => {
  it("rejoignent l'emploi du temps suivi, pour rester visibles", async () => {
    const w = (await db.user.create({ data: { email: "mixte@test.local", passwordHash: "x", settings: { create: {} } } })).id;
    const followed = (await imports.createSchedule(w, { label: "S1" })).id;
    await db.scheduleEvent.create({ data: { userId: w, title: "Cours manuel", date: MONDAY, startMinutes: 900, endMinutes: 960 } });
    const { imports: list } = await imports.listImports(w);
    expect(list.map((i) => i.label)).toEqual(["S1"]);
    expect((await agenda.listRange(w, MONDAY, SUNDAY, followed)).occurrences.map((o) => o.title)).toEqual(["Cours manuel"]);
  });
});
