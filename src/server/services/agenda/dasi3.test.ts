// Scénario de référence : import complet de DASI 3, puis agenda académique. Vrai Prisma sur PGlite, faux fournisseur IA.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider } from "@/server/ai/provider";
import { computeGrid, slotBox, overlaps, weekday } from "@/server/domain/schedule";
import { DASI_AI_ANSWER, DASI_ITEMS } from "./dasi3.fixture";
import { layoutFromItems } from "./pdf-layout";

vi.mock("./pdf-layout", async (original) => {
  const actual = await original<typeof import("./pdf-layout")>();
  const { DASI_ITEMS: items } = await import("./dasi3.fixture");
  return { ...actual, pdfLayout: async () => actual.layoutFromItems(items) };
});

let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let db: typeof import("@/lib/db").db;
let agenda: typeof import("./agenda");
let imports: typeof import("./import");
let tasks: typeof import("./tasks");
let progress: typeof import("@/server/services/progress/progress");
let prov: typeof import("@/server/ai/provider");
let A: string;
let B: string;
let draft: Awaited<ReturnType<typeof import("./import").startImport>>;

const fake: AiProvider = { name: "fake", model: "fake-1", async complete() { return { text: JSON.stringify(DASI_AI_ANSWER), model: "fake-1" }; } };
const SUNDAY = { date: "2026-11-08", minutes: 480 };
const between = (u: string, from: string, to: string) => agenda.occurrencesBetween(u, from, to).then((r) => r.occurrences);
const rowOf = (title: string, day: number, start: number) => draft.events.find((e) => e.title === title && e.day === day && e.startMinutes === start)!;
const mmdd = (l: string[] | null | undefined) => (l ?? []).map((d) => d.slice(5));
const task = (over: Record<string, unknown>) => tasks.createTask(A, tasks.createTaskSchema.parse({ title: "TD Java EE", type: "TD", dueDate: "2026-11-12", dueMinutes: 840, ...over }));

beforeAll(async () => {
  pg = await PGlite.create();
  const dirMig = path.join(process.cwd(), "prisma", "migrations");
  for (const name of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261109000000_niala_reliability", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261113000000_niala_google_link", "20261116000000_niala_profile_exercises", "20261117000000_niala_class_level_other", "20261118000000_niala_admin"]) await pg.exec(readFileSync(path.join(dirMig, name, "migration.sql"), "utf8"));
  const port = 30000 + Math.floor(Math.random() * 10000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-dasi-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  db = (await import("@/lib/db")).db;
  agenda = await import("./agenda");
  imports = await import("./import");
  tasks = await import("./tasks");
  progress = await import("@/server/services/progress/progress");
  prov = await import("@/server/ai/provider");
  prov.__setProviderForTests(fake);
  A = (await db.user.create({ data: { email: "dasi-a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "dasi-b@x.fr", passwordHash: "x" } })).id;

  draft = await imports.startImport(A, new File([Buffer.from("%PDF-1.4 dasi")], "DASI 3.pdf", { type: "application/pdf" }));
  await imports.confirmImport(A, draft.id, imports.confirmSchema.parse({
    mode: "add",
    startDate: "2026-11-02",
    events: draft.events.map((e) => ({ ...e, day: e.day!, startMinutes: e.startMinutes!, endMinutes: e.endMinutes!, createSubject: true })),
    breaks: draft.breaks,
    specials: draft.specials,
  }));
}, 120_000);

afterAll(async () => {
  prov?.__setProviderForTests(undefined);
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("lecture de DASI 3", () => {
  it("relie les codes aux intitulés et garde le code dans les détails", () => {
    expect(rowOf("Java EE", 1, 615).code).toBe("1INF3403");
    expect(rowOf("Gestion de projets", 5, 870).code).toBe("1MAN3400");
    expect(rowOf("UML et Java", 2, 450).code).toBe("1INF3400");
    expect(rowOf("Entrepreunariat", 4, 450).code).toBe("1MAN3401");
    expect(rowOf("AGL avec la méthode AGILE", 3, 450).code).toBe("1INF3404");
    expect(rowOf("Développement web et multimédia", 4, 870).code).toBe("1INF3405");
  });

  it("reconnaît les 10 semaines et leurs dates d'après leur colonne", () => {
    const layout = layoutFromItems(DASI_ITEMS)!;
    expect(layout.weeks).toHaveLength(10);
    expect(layout.weeks[0]).toEqual({ numero: 1, debut: "2026-11-02" });
    expect(layout.weeks[9]).toEqual({ numero: 10, debut: "2027-01-04" });
  });

  it("une cellule vide n'est jamais un cours, même si le modèle a décalé les colonnes", () => {
    expect(mmdd(rowOf("Développement web et multimédia", 5, 450).dates)).toEqual(["11-06", "11-13", "11-20", "11-27", "12-11", "12-18"]);
    expect(mmdd(rowOf("Gestion de projets", 5, 615).dates)).toEqual(["11-13", "11-20", "11-27", "12-11", "12-18"]);
    expect(mmdd(rowOf("Gestion de projets", 5, 870).dates)).toEqual(["11-06", "11-13", "11-20", "11-27", "12-11"]);
    expect(mmdd(rowOf("DEVOIRS ET COURS DE RATTRAPAGE", 6, 480).dates)).toEqual(["11-21", "11-28", "12-05", "12-12", "12-19"]);
  });

  it("garde les cours présents certaines semaines seulement, et les alternances", () => {
    expect(rowOf("AGL avec la méthode AGILE", 1, 870).dates).toHaveLength(5);
    expect(rowOf("UML et Java", 2, 615)).toMatchObject({ date: "2026-12-15", dates: null, recurring: false });
    expect(mmdd(rowOf("SPORT", 3, 990).dates)).toEqual(["11-04", "11-18", "12-02", "12-16"]);
    expect(mmdd(rowOf("COACHING", 3, 990).dates)).toEqual(["11-11", "11-25", "12-09"]);
  });

  it("identifie les journées particulières et les périodes sans cours", () => {
    expect(draft.specials.map((s) => [s.label, s.startDate, s.endDate])).toEqual(expect.arrayContaining([["JOURNEE CULTURELLE", "2026-12-04", "2026-12-04"], ["CONGE DE NOEL ET DU NOUVEL AN", "2026-12-21", "2027-01-03"], ["EXAMENS DEUXIEME PARTIE SEMESTRES IMPAIRS", "2027-01-04", "2027-01-10"]]));
    expect(draft.events.some((e) => e.title === "JOURNEE CULTURELLE")).toBe(false);
    expect(draft.specials.find((s) => s.label === "JOURNEE CULTURELLE")).toMatchObject({ startMinutes: 450, endMinutes: 1020 });
    expect(draft.specials.find((s) => s.kind === "HOLIDAY")).toMatchObject({ startMinutes: null, endMinutes: null });
  });

  it("déduit les pauses réelles sans les imposer aux jours qui n'en ont pas", () => {
    const at = (s: number) => draft.breaks.filter((b) => b.startMinutes === s).map((b) => b.weekday);
    expect(at(600)).toEqual([2, 3, 4, 5]);
    expect(at(765)).toEqual([1, 2, 4, 5]);
    expect(rowOf("JOURNEE DE LA SALUBRITE 1", 6, 480).issues).toEqual([]);
  });

  it("signale ce qui reste incertain au lieu de l'inventer", () => {
    expect(rowOf("DASI 3", 2, 870)).toMatchObject({ confidence: "moyenne" });
    expect(rowOf("DASI 3", 2, 870).issues.join(" ")).toContain("intitulé à préciser");
    expect(rowOf("APP 3", 2, 870).room).toBeNull();
  });
});

describe("agenda après import", () => {
  it("n'affiche que les vraies séances d'une semaine, avec des durées différentes", async () => {
    const list = await between(A, "2026-11-30", "2026-12-06");
    const friday = list.filter((o) => o.date === "2026-12-04");
    expect(friday.map((o) => [o.title, o.allDay])).toEqual([["JOURNEE CULTURELLE", true]]);
    const durations = new Set(list.filter((o) => !o.allDay).map((o) => o.endMinutes - o.startMinutes));
    expect([...durations].sort((a, b) => a - b)).toEqual([90, 150, 240]);
  });

  it("n'affiche aucun cours pendant les congés", async () => {
    const list = await between(A, "2026-12-21", "2027-01-03");
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((o) => o.allDay && o.kind === "HOLIDAY")).toBe(true);
  });

  it("calcule une grille à partir des horaires réels, hauteurs proportionnelles", async () => {
    const list = (await between(A, "2026-11-30", "2026-12-06")).filter((o) => !o.allDay);
    const { breaks } = await agenda.occurrencesBetween(A, "2026-11-30", "2026-12-06");
    const grid = computeGrid(list, breaks);
    expect([grid.start, grid.end]).toEqual([450, 1080]);
    expect(grid.marks).toEqual(expect.arrayContaining([450, 600, 615, 765, 870, 1020, 990, 1080]));
    expect(slotBox({ startMinutes: 450, endMinutes: 600 }, grid.start, 48).height).toBe(120);
    expect(slotBox({ startMinutes: 990, endMinutes: 1080 }, grid.start, 48).height).toBe(72);
  });

  it("modifie une séance sans toucher à la série", async () => {
    const [o] = (await between(A, "2026-11-09", "2026-11-09")).filter((x) => x.code === "1INF3403");
    await agenda.updateEvent(A, o.eventId, agenda.patchEventSchema.parse({ scope: "occurrence", occurrenceDate: "2026-11-09", startMinutes: 480, endMinutes: 630, room: "B2" }));
    expect((await between(A, "2026-11-09", "2026-11-09")).find((x) => x.code === "1INF3403")).toMatchObject({ startMinutes: 480, room: "B2", overridden: true });
    expect((await between(A, "2026-11-16", "2026-11-16")).find((x) => x.code === "1INF3403")).toMatchObject({ startMinutes: 615, room: null, overridden: false });
  });

  it("un réimport identique ne crée aucun doublon", async () => {
    const again = await imports.startImport(A, new File([Buffer.from("%PDF-1.4 dasi")], "DASI 3.pdf", { type: "application/pdf" }));
    expect(again.events.filter((e) => e.recurring).every((e) => e.status === "identique")).toBe(true);
  });
});

describe("échéances et planification", () => {
  it("ajoute puis supprime une échéance, sans fuite entre comptes", async () => {
    const t = await task({ title: "À supprimer" });
    expect((await tasks.listTasks(A, SUNDAY)).some((x) => x.id === t.id)).toBe(true);
    expect(await tasks.listTasks(B, SUNDAY)).toHaveLength(0);
    await expect(tasks.deleteTask(B, t.id)).rejects.toMatchObject({ status: 404 });
    await tasks.deleteTask(A, t.id);
    expect((await tasks.listTasks(A, SUNDAY)).some((x) => x.id === t.id)).toBe(false);
  });

  it("un TD à rendre terminé mais non soumis reste en retard ; un exercice terminé non", async () => {
    const td = await task({ title: "TD rendu", requiresSubmission: true, dueDate: "2026-11-05" });
    const ex = await task({ title: "Exercice fini", type: "EXERCICE", dueDate: "2026-11-05" });
    await tasks.updateTask(A, td.id, { status: "TERMINE" });
    await tasks.updateTask(A, ex.id, { status: "TERMINE" });
    const status = async (id: string) => (await tasks.listTasks(A, SUNDAY)).find((x) => x.id === id)!.status;
    expect(await status(td.id)).toBe("EN_RETARD");
    expect(await status(ex.id)).toBe("TERMINE");
    await tasks.updateTask(A, td.id, { status: "SOUMIS" });
    expect(await status(td.id)).toBe("SOUMIS");
  });

  it("propose des séances sans conflit avec les cours, les pauses et les autres séances", async () => {
    const t = await task({ title: "Projet Java EE", type: "PROJET", estimatedMinutes: 300, dueDate: "2026-11-13", dueMinutes: 1080 });
    const plan = await tasks.proposePlan(A, t.id, SUNDAY);
    expect(plan.feasible).toBe(true);
    expect(plan.plannedMinutes).toBe(300);
    const { occurrences, breaks } = await agenda.occurrencesBetween(A, "2026-11-08", "2026-11-13");
    for (const s of plan.sessions) {
      expect(occurrences.filter((o) => !o.allDay && o.date === s.date).some((o) => overlaps(s, o))).toBe(false);
      expect(breaks.filter((b) => b.weekday === null || b.weekday === weekday(s.date)).some((b) => overlaps(s, b))).toBe(false);
    }
    await tasks.acceptPlan(A, t.id, { sessions: plan.sessions.map(({ date, startMinutes, endMinutes }) => ({ date, startMinutes, endMinutes })) });
    const other = await task({ title: "Autre", estimatedMinutes: 120, dueDate: "2026-11-13", dueMinutes: 1080 });
    const second = await tasks.proposePlan(A, other.id, SUNDAY);
    for (const s of second.sessions) expect(plan.sessions.filter((p) => p.date === s.date).some((p) => overlaps(s, p))).toBe(false);
  });

  it("dit honnêtement quand le temps manque, et demande confirmation sur un cours", async () => {
    const t = await task({ title: "Trop long", estimatedMinutes: 6000, dueDate: "2026-11-10", dueMinutes: 1080 });
    const plan = await tasks.proposePlan(A, t.id, SUNDAY);
    expect(plan.feasible).toBe(false);
    expect(plan.missingMinutes).toBeGreaterThan(0);
    expect(plan.message).toContain("manque");
    await expect(tasks.acceptPlan(A, t.id, { sessions: [{ date: "2026-11-16", startMinutes: 900, endMinutes: 960 }] })).rejects.toMatchObject({ status: 409 });
  });

  it("synchronise le tableau de bord : cours réels, pauses, retards et séances", async () => {
    const data = await progress.dashboard(A, { date: "2026-11-16", minutes: 480 });
    expect(data.today.filter((c) => c.date === "2026-11-16").map((c) => c.title)).toEqual(["Java EE", "AGL avec la méthode AGILE"]);
    expect(data.breaks.length).toBeGreaterThan(0);
    expect(data.academic.late.map((t) => t.title)).toContain("Trop long");
    expect(data.highlight.kind).toBe("task");
    expect((await progress.dashboard(B, { date: "2026-11-16", minutes: 480 })).academic.late).toHaveLength(0);
  });
});
