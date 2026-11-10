// Tests d'intégration du profil, de l'inscription par catégorie et de la gestion du compte (vraie base PGlite).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { profileColumns, profileInputSchema } from "@/server/domain/profile";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.has(n) ? { value: jar.get(n)! } : undefined), set: (n: string, v: string) => jar.set(n, v) }),
}));

type Db = typeof import("@/lib/db").db;
let db: Db;
let accounts: typeof import("./accounts");
let profile: typeof import("./profile");
let auth: typeof import("@/lib/auth");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;

const PASSWORD = "un-mot-de-passe-de-test";
const signup = (email: string, p: unknown) => accounts.registerUser(accounts.signupSchema.parse({ name: "Ada Test", email, password: PASSWORD, profile: p }));

beforeAll(async () => {
  pg = await PGlite.create();
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(root).filter((n) => /^\d/.test(n) && !n.includes("v2_rls")).sort()) await pg.exec(readFileSync(path.join(root, name, "migration.sql"), "utf8"));
  const port = 50000 + Math.floor(Math.random() * 4000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-profile-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  db = (await import("@/lib/db")).db;
  accounts = await import("./accounts");
  profile = await import("./profile");
  auth = await import("@/lib/auth");
}, 120_000);

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("validation par catégorie", () => {
  it("exige une catégorie", () => {
    expect(profileInputSchema.safeParse({}).success).toBe(false);
  });
  it("ESATIC : un seul champ libre « classe / filière » (ex. DASI 3), obligatoire", () => {
    expect(profileInputSchema.safeParse({ category: "ESATIC" }).success).toBe(false);
    expect(profileInputSchema.safeParse({ category: "ESATIC", field: "" }).success).toBe(false);
    expect(profileInputSchema.safeParse({ category: "ESATIC", field: "x" }).success).toBe(false);
    expect(profileInputSchema.safeParse({ category: "ESATIC", field: "x".repeat(61) }).success).toBe(false);
    expect(profileInputSchema.parse({ category: "ESATIC", field: "  DASI 3  " })).toEqual({ category: "ESATIC", field: "DASI 3" });
    for (const f of ["SIGL 1", "RTEL 2", "TWIN 3", "SRIT 1", "CSIA 2", "Intelligence artificielle 3"]) expect(profileInputSchema.safeParse({ category: "ESATIC", field: f }).success).toBe(true);
  });
  it("ne demande plus ni niveau, ni classe, ni code de filière, et les ignore s'ils sont envoyés", () => {
    const parsed = profileInputSchema.parse({ category: "ESATIC", field: "DASI 3", level: "L3", className: "DASI 3 B", fieldCode: "DASI", levelOther: "x" });
    expect(parsed).toEqual({ category: "ESATIC", field: "DASI 3" });
    expect(profileColumns(parsed)).toMatchObject({ field: "DASI 3", institution: "ESATIC", level: null, levelOther: null, className: null, fieldCode: null });
  });
  it("autre établissement : établissement et classe / filière libres", () => {
    expect(profileInputSchema.safeParse({ category: "OTHER_SCHOOL", field: "Réseaux 2" }).success).toBe(false);
    expect(profileInputSchema.safeParse({ category: "OTHER_SCHOOL", institution: "Lycée X" }).success).toBe(false);
    expect(profileInputSchema.safeParse({ category: "OTHER_SCHOOL", institution: "Lycée X", field: "Terminale D" }).success).toBe(true);
  });
  it("testeur : aucun champ académique imposé", () => {
    expect(profileInputSchema.safeParse({ category: "TESTER" }).success).toBe(true);
  });
  it("efface les champs des autres catégories", () => {
    const columns = profileColumns(profileInputSchema.parse({ category: "TESTER", situation: "Curieux" }));
    expect(columns).toMatchObject({ category: "TESTER", institution: null, field: null, level: null, situation: "Curieux" });
  });
});

describe("inscription", () => {
  it("enregistre un étudiant ESATIC et rattache l'établissement", async () => {
    const u = await signup("esatic@x.fr", { category: "ESATIC", field: "DASI 3" });
    expect(await profile.getProfile(u.id)).toMatchObject({ category: "ESATIC", institution: "ESATIC", field: "DASI 3" });
  });
  it("enregistre un étudiant d'une autre école", async () => {
    const u = await signup("autre@x.fr", { category: "OTHER_SCHOOL", institution: "INP-HB", field: "Génie logiciel BTS1" });
    expect(await profile.getProfile(u.id)).toMatchObject({ category: "OTHER_SCHOOL", institution: "INP-HB", field: "Génie logiciel BTS1" });
  });
  it("enregistre un testeur sans parcours", async () => {
    const u = await signup("test@x.fr", { category: "TESTER", usageReason: "Découvrir" });
    expect(await profile.getProfile(u.id)).toMatchObject({ category: "TESTER", institution: null, field: null, usageReason: "Découvrir" });
  });
  it("refuse une inscription sans réponse à la question ESATIC", () => {
    expect(accounts.signupSchema.safeParse({ name: "A", email: "a@b.fr", password: PASSWORD }).success).toBe(false);
  });
});

describe("modification du profil", () => {
  it("passe d'une catégorie à l'autre sans garder d'anciennes valeurs", async () => {
    const u = await signup("switch@x.fr", { category: "ESATIC", field: "DASI 4" });
    await profile.updateProfile(u.id, { name: "Nouveau Nom", academic: profileInputSchema.parse({ category: "TESTER" }) });
    expect(await profile.getProfile(u.id)).toMatchObject({ name: "Nouveau Nom", category: "TESTER", institution: null, field: null });
  });
  it("ajoute puis retire une photo, sans toucher au parcours", async () => {
    const u = await signup("photo@x.fr", { category: "ESATIC", field: "DASI 1" });
    await profile.updateProfile(u.id, { avatar: "data:image/jpeg;base64,AAAA" });
    expect(await profile.getProfile(u.id)).toMatchObject({ avatar: "data:image/jpeg;base64,AAAA", field: "DASI 1" });
    await profile.updateProfile(u.id, { avatar: null });
    expect((await profile.getProfile(u.id)).avatar).toBeNull();
  });
  it("refuse une image qui n'en est pas une", () => {
    expect(profile.profileUpdateSchema.safeParse({ avatar: "javascript:alert(1)" }).success).toBe(false);
  });
  it("ne renvoie aucune donnée d'authentification interne", async () => {
    const u = await signup("safe@x.fr", { category: "TESTER" });
    expect(JSON.stringify(await profile.getProfile(u.id))).not.toContain("scrypt");
  });
});

describe("compte", () => {
  it("change l'adresse après confirmation du mot de passe", async () => {
    const u = await signup("mail@x.fr", { category: "TESTER" });
    await expect(profile.changeEmail(u.id, { email: "n@x.fr", password: "faux" })).rejects.toMatchObject({ status: 403 });
    await expect(profile.changeEmail(u.id, { email: "esatic@x.fr", password: PASSWORD })).rejects.toMatchObject({ status: 409 });
    expect(await profile.changeEmail(u.id, { email: "New@x.fr", password: PASSWORD })).toEqual({ email: "new@x.fr" });
  });
  it("refuse de changer le mot de passe d'un compte Google", async () => {
    const g = await db.user.create({ data: { email: "g@x.fr", passwordHash: "oauth:google:1" } });
    await expect(profile.changePassword(g.id, { current: "x", next: "nouveau-mot-de-passe" })).rejects.toMatchObject({ status: 409 });
  });
  it("ferme les autres sessions, y compris celles émises avant les versions", async () => {
    const u = await signup("session@x.fr", { category: "TESTER" });
    await auth.setSessionCookie(u.id);
    const token = jar.get("sfs_session")!;
    expect(token.split(".")).toHaveLength(4);
    expect((await auth.getCurrentUser())?.id).toBe(u.id);
    await profile.revokeSessions(u.id);
    expect(await auth.getCurrentUser()).toBeNull();
    await auth.setSessionCookie(u.id);
    expect((await auth.getCurrentUser())?.id).toBe(u.id);
  });
  it("supprime le compte et toutes ses données après confirmation", async () => {
    const u = await signup("bye@x.fr", { category: "TESTER" });
    await db.subject.create({ data: { userId: u.id, name: "Algo" } });
    await db.programRun.create({ data: { userId: u.id, language: "python", code: "1" } });
    await expect(profile.deleteAccount(u.id, { password: "faux" })).rejects.toMatchObject({ status: 403 });
    await profile.deleteAccount(u.id, { password: PASSWORD });
    expect(await db.user.count({ where: { id: u.id } })).toBe(0);
    expect(await db.subject.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.programRun.count({ where: { userId: u.id } })).toBe(0);
    expect(await db.studentProfile.count({ where: { userId: u.id } })).toBe(0);
  });
  it("confirme la suppression d'un compte Google par son adresse", async () => {
    const g = await db.user.create({ data: { email: "g2@x.fr", passwordHash: "oauth:google:2" } });
    await expect(profile.deleteAccount(g.id, { confirmEmail: "autre@x.fr" })).rejects.toMatchObject({ status: 403 });
    await expect(profile.deleteAccount(g.id, { confirmEmail: "G2@x.fr" })).resolves.toEqual({ ok: true });
  });
  it("exporte les données sans le moindre secret", async () => {
    const u = await signup("export@x.fr", { category: "TESTER" });
    const data = await profile.exportAccount(u.id);
    expect(data.profile).toMatchObject({ email: "export@x.fr", category: "TESTER" });
    expect(JSON.stringify(data)).not.toMatch(/scrypt|passwordHash|aiModel|retentionDays/);
  });
});
