// Limitation de débit durable : compteur en base commun à toutes les instances, et repli en mémoire si la base manque.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let rl: typeof import("@/lib/rate-limit");

beforeAll(async () => {
  ctx = await startTestDb();
  rl = await import("@/lib/rate-limit");
});
afterAll(async () => {
  await ctx.stop();
});

describe("limitation de débit durable", () => {
  it("compte en base et bloque au-delà du plafond", async () => {
    for (let i = 0; i < 3; i++) expect(await rl.durableLimit("t:plafond", 3, 60_000)).toBe(true);
    expect(await rl.durableLimit("t:plafond", 3, 60_000)).toBe(false);
    expect(await rl.durableCount("t:plafond")).toBe(4);
    expect(await ctx.db.rateLimit.count()).toBe(1);
  });

  it("ne conserve jamais la clé en clair (adresse IP, e-mail)", async () => {
    await rl.durableHit("login:fail:etudiant@niala.test:203.0.113.9", 60_000);
    const rows = await ctx.db.rateLimit.findMany();
    expect(rows.some((r) => r.key.includes("niala.test") || r.key.includes("203.0.113.9"))).toBe(false);
  });

  it("repart de zéro quand la fenêtre est écoulée ou après remise à zéro", async () => {
    expect(await rl.durableHit("t:fenetre", 60_000)).toBe(1);
    expect(await rl.durableHit("t:fenetre", 60_000)).toBe(2);
    await ctx.db.rateLimit.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } });
    expect(await rl.durableCount("t:fenetre")).toBe(0);
    expect(await rl.durableHit("t:fenetre", 60_000)).toBe(1);
    await rl.durableReset("t:fenetre");
    expect(await rl.durableCount("t:fenetre")).toBe(0);
  });

  it("compte correctement des requêtes simultanées", async () => {
    const counts = await Promise.all(Array.from({ length: 10 }, () => rl.durableHit("t:simultane", 60_000)));
    expect([...counts].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("se replie sur la mémoire si la table est indisponible (migration non appliquée)", async () => {
    await ctx.db.$executeRawUnsafe('ALTER TABLE "RateLimit" RENAME TO "RateLimit_absent"');
    try {
      expect(await rl.durableLimit("t:repli", 2, 60_000)).toBe(true);
      expect(await rl.durableLimit("t:repli", 2, 60_000)).toBe(true);
      expect(await rl.durableLimit("t:repli", 2, 60_000)).toBe(false);
      expect(await rl.durableCount("t:repli")).toBe(3);
    } finally {
      await ctx.db.$executeRawUnsafe('ALTER TABLE "RateLimit_absent" RENAME TO "RateLimit"');
    }
  });
});
