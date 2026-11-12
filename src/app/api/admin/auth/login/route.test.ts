// Connexion administrateur : résistance à la force brute (compteurs en base, verrouillage, journal d'audit).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

let ip = "203.0.113.1";
const setAdminCookie = vi.fn(async () => undefined);
vi.mock("@/server/admin/session", async (original) => ({
  ...(await original<typeof import("@/server/admin/session")>()),
  requestMeta: async () => ({ ip, userAgent: "test" }),
  setAdminCookie,
}));
// Le délai imposé après un échec est neutralisé pour que la suite reste rapide.
const realSetTimeout = globalThis.setTimeout;
vi.stubGlobal("setTimeout", ((fn: () => void, ms?: number) => realSetTimeout(fn, ms === 800 ? 0 : ms)) as unknown as typeof setTimeout);

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let POST: typeof import("./route").POST;
const PASSWORD = "mot-de-passe-admin-123";

const attempt = async (email: string, password: string) => {
  const res = await POST(new Request("https://niala.test/api/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }));
  return { status: res.status, body: (await res.json()) as { error?: string; ok?: boolean } };
};

beforeAll(async () => {
  ctx = await startTestDb();
  const auth = await import("@/lib/auth");
  for (const email of ["root@niala.test", "chef@niala.test"]) {
    await ctx.db.user.create({ data: { email, name: "Admin", passwordHash: auth.hashPassword(PASSWORD), adminRole: "SUPER_ADMIN", settings: { create: {} } } });
  }
  ({ POST } = await import("./route"));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await ctx.stop();
});
beforeEach(() => setAdminCookie.mockClear());

describe("force brute sur la connexion administrateur", () => {
  it("verrouille une adresse IP après 5 échecs, même si le bon mot de passe arrive ensuite", async () => {
    ip = "203.0.113.10";
    for (let i = 0; i < 5; i++) expect((await attempt("root@niala.test", `essai-${i}`)).status).toBe(401);
    const locked = await attempt("root@niala.test", PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error).toContain("Trop de tentatives");
    expect(setAdminCookie).not.toHaveBeenCalled();
    // Le verrouillage est consigné dans le journal d'audit.
    expect(await ctx.db.adminAuditLog.count({ where: { action: "admin.login_failed", result: "DENIED" } })).toBe(1);
    expect(await ctx.db.adminAuditLog.count({ where: { action: "admin.login_failed", result: "FAILED" } })).toBe(5);
  });

  it("ne gêne pas un administrateur légitime venant d'une autre adresse", async () => {
    ip = "203.0.113.20";
    const ok = await attempt("root@niala.test", PASSWORD);
    expect(ok.status).toBe(200);
    expect(setAdminCookie).toHaveBeenCalledTimes(1);
  });

  it("verrouille un compte attaqué depuis de nombreuses adresses (10 échecs)", async () => {
    for (let i = 0; i < 10; i++) {
      ip = `198.51.100.${i + 1}`;
      expect((await attempt("chef@niala.test", "mauvais")).status).toBe(401);
    }
    ip = "198.51.100.200";
    expect((await attempt("chef@niala.test", PASSWORD)).status).toBe(429);
  });

  it("répond de la même façon pour une adresse inconnue et pour un mauvais mot de passe", async () => {
    ip = "203.0.113.30";
    const unknown = await attempt("personne@niala.test", "x");
    ip = "203.0.113.31";
    const wrong = await attempt("root@niala.test", "x");
    expect(unknown).toEqual(wrong);
  });

  it("refuse un mot de passe démesuré sans le hacher", async () => {
    ip = "203.0.113.40";
    expect((await attempt("root@niala.test", "x".repeat(5000))).status).toBe(422);
  });
});
