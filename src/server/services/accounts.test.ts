// Tests d'intégration des comptes : inscription et connexion Google sur une vraie base PGlite.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

type Db = typeof import("@/lib/db").db;
let db: Db;
let accounts: typeof import("./accounts");
let auth: typeof import("@/lib/auth");
let server: PGLiteSocketServer;
let pg: PGlite;

const PASSWORD = "un-mot-de-passe-de-test";
const google = (o: Partial<import("./accounts").GoogleProfile> = {}) => ({ sub: "google-1", email: "Google@Example.fr", emailVerified: true, name: "Ada Test", firstName: "Ada", lastName: "Test", avatarUrl: null, ...o });

beforeAll(async () => {
  pg = await PGlite.create();
  for (const name of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261113000000_niala_google_link"]) {
    await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "migrations", name, "migration.sql"), "utf8"));
  }
  const port = 45000 + Math.floor(Math.random() * 4000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  db = (await import("@/lib/db")).db;
  accounts = await import("./accounts");
  auth = await import("@/lib/auth");
}, 90_000);

afterAll(async () => {
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
});

describe("inscription par e-mail", () => {
  it("crée un compte connectable, avec ses préférences et un mot de passe haché", async () => {
    const user = await accounts.registerUser({ name: "Bob", email: " Bob@Example.fr ", password: PASSWORD });
    expect(user.email).toBe("bob@example.fr");
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { settings: true } });
    expect(stored.settings).not.toBeNull();
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(auth.verifyPassword(PASSWORD, stored.passwordHash)).toBe(true);
  });

  it("refuse une adresse déjà inscrite, quelle que soit la casse", async () => {
    await expect(accounts.registerUser({ name: "Autre", email: "BOB@example.fr", password: PASSWORD })).rejects.toMatchObject({ status: 409 });
  });

  it("refuse un mot de passe trop court", () => {
    expect(accounts.registerSchema.safeParse({ name: "A", email: "a@b.fr", password: "court" }).success).toBe(false);
  });
});

describe("profil Google renvoyé par Supabase", () => {
  const user = { email: "ada@example.fr", user_metadata: { full_name: "Ada Lovelace", given_name: "Ada", family_name: "Lovelace", avatar_url: "https://exemple.invalid/a.png", email_verified: true }, identities: [{ provider: "google", identity_data: { sub: "g-42", email_verified: true } }] };

  it("récupère le nom, le prénom, l'e-mail et la photo", () => {
    expect(accounts.googleProfileOf(user)).toEqual({ sub: "g-42", email: "ada@example.fr", emailVerified: true, name: "Ada Lovelace", firstName: "Ada", lastName: "Lovelace", avatarUrl: "https://exemple.invalid/a.png" });
  });

  it("recompose le nom à partir du prénom et du nom de famille", () => {
    expect(accounts.googleProfileOf({ ...user, user_metadata: { given_name: "Ada", family_name: "Lovelace" } })?.name).toBe("Ada Lovelace");
  });

  it("ne considère l'adresse vérifiée que si Google l'indique", () => {
    expect(accounts.googleProfileOf({ ...user, user_metadata: {}, identities: [{ provider: "google", identity_data: { sub: "g" } }] })?.emailVerified).toBe(false);
  });

  it("ignore un utilisateur sans identité Google", () => {
    expect(accounts.googleProfileOf({ ...user, identities: [{ provider: "email", identity_data: {} }] })).toBeNull();
  });
});

describe("connexion Google", () => {
  it("crée le compte à la première connexion, puis retrouve le même", async () => {
    const first = await accounts.signInWithGoogle(google());
    expect(first).toMatchObject({ email: "google@example.fr", name: "Ada Test" });
    expect((await accounts.signInWithGoogle(google())).id).toBe(first.id);
  });

  it("met à jour le nom sans créer de second compte", async () => {
    const before = await db.user.count();
    expect(await accounts.signInWithGoogle(google({ name: "Ada Lovelace" }))).toMatchObject({ name: "Ada Lovelace" });
    expect(await db.user.count()).toBe(before);
  });

  it("un compte Google n'accepte aucun mot de passe", async () => {
    const stored = await db.user.findUniqueOrThrow({ where: { email: "google@example.fr" } });
    expect(auth.verifyPassword(stored.passwordHash, stored.passwordHash)).toBe(false);
    expect(auth.verifyPassword("oauth", stored.passwordHash)).toBe(false);
  });

  it("refuse une adresse Google non vérifiée", async () => {
    await expect(accounts.signInWithGoogle(google({ sub: "g2", email: "nv@example.fr", emailVerified: false }))).rejects.toMatchObject({ reason: "unverified" });
    expect(await db.user.findUnique({ where: { email: "nv@example.fr" } })).toBeNull();
  });

  it("ne rattache jamais un compte existant par mot de passe", async () => {
    await expect(accounts.signInWithGoogle(google({ sub: "g3", email: "bob@example.fr" }))).rejects.toMatchObject({ reason: "account_exists" });
  });

  it("refuse un autre compte Google qui présenterait la même adresse", async () => {
    await expect(accounts.signInWithGoogle(google({ sub: "autre" }))).rejects.toMatchObject({ reason: "account_conflict" });
  });
});

describe("liaison de Google à un compte par mot de passe", () => {
  const link = { sub: "g-bob", email: "Bob@Example.fr", name: "Bob Google" };

  it("refuse un mot de passe incorrect sans rien lier", async () => {
    await expect(accounts.linkGoogleAccount(link, "mauvais-mot-de-passe")).rejects.toMatchObject({ reason: "invalid_password" });
    expect((await db.user.findUniqueOrThrow({ where: { email: "bob@example.fr" } })).googleSub).toBeNull();
  });

  it("lie l'identité Google après confirmation, en gardant le mot de passe et les données", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { email: "bob@example.fr" } });
    const user = await accounts.linkGoogleAccount(link, PASSWORD);
    expect(user.id).toBe(before.id);
    const after = await db.user.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.googleSub).toBe("g-bob");
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(auth.verifyPassword(PASSWORD, after.passwordHash)).toBe(true);
  });

  it("connecte ensuite directement avec Google, sans second compte", async () => {
    const count = await db.user.count();
    const user = await accounts.signInWithGoogle(google({ sub: "g-bob", email: "bob@example.fr" }));
    expect(user.email).toBe("bob@example.fr");
    expect(await db.user.count()).toBe(count);
  });

  it("reconnaît le compte lié même si l'adresse Google a changé", async () => {
    expect((await accounts.signInWithGoogle(google({ sub: "g-bob", email: "autre-adresse@example.fr" }))).email).toBe("bob@example.fr");
  });

  it("refuse de lier une autre identité Google à un compte déjà lié", async () => {
    await expect(accounts.signInWithGoogle(google({ sub: "g-intrus", email: "bob@example.fr" }))).rejects.toMatchObject({ reason: "account_conflict" });
    await expect(accounts.linkGoogleAccount({ ...link, sub: "g-intrus" }, PASSWORD)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("refuse la liaison d'un compte Google ou d'une adresse inconnue", async () => {
    await expect(accounts.linkGoogleAccount({ sub: "x", email: "google@example.fr", name: null }, PASSWORD)).rejects.toMatchObject({ reason: "unavailable" });
    await expect(accounts.linkGoogleAccount({ sub: "x", email: "inconnu@example.fr", name: null }, PASSWORD)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("refuse une identité Google déjà liée à un autre compte", async () => {
    await accounts.registerUser({ name: "Cleo", email: "cleo@example.fr", password: PASSWORD });
    await expect(accounts.linkGoogleAccount({ sub: "g-bob", email: "cleo@example.fr", name: null }, PASSWORD)).rejects.toMatchObject({ reason: "unavailable" });
  });
});
