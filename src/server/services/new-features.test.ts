// Tests d'intégration des nouveautés : mot de passe oublié, emplois du temps multiples, limite de connexion par client.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let db: Ctx["db"];
let reset: typeof import("./password-reset");
let auth: typeof import("@/lib/auth");
let agenda: typeof import("./agenda/agenda");
let imports: typeof import("./agenda/import");
let storageDir: string;
let U: string;

beforeAll(async () => {
  storageDir = mkdtempSync(path.join(tmpdir(), "niala-new-"));
  process.env.STORAGE_DIR = storageDir;
  delete process.env.RESEND_API_KEY;
  ctx = await startTestDb();
  db = ctx.db;
  reset = await import("./password-reset");
  auth = await import("@/lib/auth");
  agenda = await import("./agenda/agenda");
  imports = await import("./agenda/import");
  U = (await db.user.create({ data: { email: "etu@test.local", passwordHash: auth.hashPassword("ancien-mot-de-passe"), settings: { create: {} } } })).id;
});

afterAll(async () => {
  await ctx?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

describe("mot de passe oublié", () => {
  it("répond pareil pour une adresse inconnue et ne crée rien", async () => {
    const r = await reset.requestPasswordReset({ email: "inconnu@test.local" }, "https://niala.test");
    expect(r).toEqual({ ok: true, delivery: "team" });
    expect(await db.supportRequest.count()).toBe(0);
  });

  it("sans envoi d'e-mail configuré, transmet la demande à l'équipe une seule fois", async () => {
    await reset.requestPasswordReset({ email: "ETU@test.local" }, "https://niala.test");
    await reset.requestPasswordReset({ email: "etu@test.local" }, "https://niala.test");
    const requests = await db.supportRequest.findMany({ where: { userId: U } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ subject: reset.RESET_REQUEST_SUBJECT, type: "ASSISTANCE" });
  });

  it("un lien de l'équipe change le mot de passe une seule fois et ferme les sessions", async () => {
    const before = (await db.user.findUniqueOrThrow({ where: { id: U } })).sessionVersion;
    const { url } = await reset.createAdminResetLink(U, "https://niala.test");
    expect(url.startsWith("https://niala.test/reinitialiser-mot-de-passe#")).toBe(true);
    const token = url.split("#")[1];
    // Seule l'empreinte est stockée.
    expect(await db.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);
    await expect(reset.resetPassword({ token, password: "court" })).rejects.toThrow();
    await reset.resetPassword({ token, password: "nouveau-mot-de-passe" });
    const user = await db.user.findUniqueOrThrow({ where: { id: U } });
    expect(auth.verifyPassword("nouveau-mot-de-passe", user.passwordHash)).toBe(true);
    expect(user.sessionVersion).toBe(before + 1);
    await expect(reset.resetPassword({ token, password: "encore-un-autre-mdp" })).rejects.toMatchObject({ status: 410 });
  });

  it("refuse un lien expiré", async () => {
    const { url } = await reset.createAdminResetLink(U, "https://niala.test");
    await db.passwordResetToken.updateMany({ where: { userId: U }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(reset.resetPassword({ token: url.split("#")[1], password: "nouveau-mot-de-passe-2" })).rejects.toMatchObject({ status: 410 });
  });
});

describe("limite de connexion propre à chaque client", () => {
  it("les tentatives d'un client n'épuisent pas le compteur d'un autre", () => {
    for (let i = 0; i < 12; i++) auth.rateLimit("login:fail:a@x:1.1.1.1", 10, 60_000);
    expect(auth.rateCount("login:fail:a@x:1.1.1.1")).toBeGreaterThanOrEqual(10);
    expect(auth.rateCount("login:fail:a@x:2.2.2.2")).toBe(0);
    auth.rateReset("login:fail:a@x:1.1.1.1");
    expect(auth.rateCount("login:fail:a@x:1.1.1.1")).toBe(0);
  });
});

describe("plusieurs emplois du temps", () => {
  const MONDAY = "2026-11-09";
  const course = (id: string, title: string, start: number) => ({ id, title, day: 1, startMinutes: start, endMinutes: start + 90, room: null, teacher: null, code: null, sessionType: null, dates: null, weekPattern: "ALL" as const, recurring: true, createSubject: false });
  const draftImport = (name: string) => db.scheduleImport.create({ data: { userId: U, fileName: name, mime: "text/csv", size: 1, sha256: name, storageKey: `${U}/edt/${name}`, draft: {}, warnings: [] } });
  let s1: string;
  let s2: string;

  it("un nouvel emploi du temps séparé est suivi et masque l'autre", async () => {
    s1 = (await draftImport("s1.csv")).id;
    await imports.confirmImport(U, s1, imports.confirmSchema.parse({ mode: "new", label: "Semestre 1", startDate: MONDAY, events: [course("a", "Algèbre", 480)] }));
    s2 = (await draftImport("s2.csv")).id;
    // Même créneau que l'autre emploi du temps : pas de conflit, ils sont indépendants.
    await imports.confirmImport(U, s2, imports.confirmSchema.parse({ mode: "new", label: "Semestre 2", startDate: MONDAY, events: [course("b", "Réseaux", 480)] }));
    const { imports: list, activeId } = await imports.listImports(U);
    expect(list.map((i) => i.label).sort()).toEqual(["Semestre 1", "Semestre 2"]);
    expect(activeId).toBe(s2);
    const week = await agenda.listRange(U, MONDAY, "2026-11-15");
    expect(week.occurrences.map((o) => o.title)).toEqual(["Réseaux"]);
  });

  it("l'étudiant choisit l'emploi du temps à suivre, ou tous", async () => {
    await imports.setActiveSchedule(U, s1);
    expect((await agenda.listRange(U, MONDAY, "2026-11-15")).occurrences.map((o) => o.title)).toEqual(["Algèbre"]);
    await imports.setActiveSchedule(U, null);
    expect((await agenda.listRange(U, MONDAY, "2026-11-15")).occurrences.map((o) => o.title).sort()).toEqual(["Algèbre", "Réseaux"]);
  });

  it("un cours ajouté à la main reste visible quel que soit l'emploi du temps suivi", async () => {
    await agenda.createEvent(U, agenda.createEventSchema.parse({ title: "Sport", date: "2026-11-10", startMinutes: 600, endMinutes: 660 }));
    await imports.setActiveSchedule(U, s1);
    expect((await agenda.listRange(U, MONDAY, "2026-11-15")).occurrences.map((o) => o.title).sort()).toEqual(["Algèbre", "Sport"]);
  });

  it("renommer puis supprimer un emploi du temps ne touche pas l'autre", async () => {
    await imports.renameSchedule(U, s2, "  S2   révisé ");
    expect((await imports.listImports(U)).imports.find((i) => i.id === s2)?.label).toBe("S2 révisé");
    // À l'ouverture de la liste, le cours ajouté sans emploi du temps a rejoint l'emploi du temps suivi (S1).
    expect((await agenda.listRange(U, MONDAY, "2026-11-15", s1)).occurrences.map((o) => o.title).sort()).toEqual(["Algèbre", "Sport"]);
    await imports.deleteSchedule(U, s1);
    const { activeId } = await imports.listImports(U);
    expect(activeId).toBeNull();
    expect((await agenda.listRange(U, MONDAY, "2026-11-15")).occurrences.map((o) => o.title).sort()).toEqual(["Réseaux"]);
  });

  it("un autre utilisateur ne peut ni suivre ni supprimer cet emploi du temps", async () => {
    const other = (await db.user.create({ data: { email: "autre@test.local", passwordHash: "x" } })).id;
    await expect(imports.setActiveSchedule(other, s2)).rejects.toMatchObject({ status: 404 });
    await expect(imports.deleteSchedule(other, s2)).rejects.toMatchObject({ status: 404 });
  });
});
