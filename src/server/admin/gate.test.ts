// Porte d'entrée : code d'accès haché, cookie de passage lié au code, blocage après des essais ratés.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

let ctx: Awaited<ReturnType<typeof startTestDb>>;
let gate: typeof import("@/server/admin/gate");
let attempt: typeof import("@/server/admin/gate-attempt");

beforeAll(async () => {
  ctx = await startTestDb();
  gate = await import("@/server/admin/gate");
  attempt = await import("@/server/admin/gate-attempt");
}, 120_000);
afterAll(async () => {
  await ctx?.stop();
});
afterEach(() => {
  delete process.env.ADMIN_ACCESS_HASH;
  delete process.env.ADMIN_PATH;
});

describe("code d'accès", () => {
  it("n'est jamais stocké en clair et se vérifie sans tenir compte de la casse ni des espaces", () => {
    const stored = gate.hashAccessCode("Lagune-Cedre-4821");
    expect(stored).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{128}$/);
    expect(stored).not.toMatch(/lagune|cedre|4821/i);
    expect(stored).not.toContain("$"); // pas d'expansion de variables dans un fichier .env
    expect(gate.verifyAccessCode("lagune-cedre-4821", stored)).toBe(true);
    expect(gate.verifyAccessCode("  LAGUNE-CEDRE-4821 ", stored)).toBe(true);
    expect(gate.verifyAccessCode("lagune-cedre-4822", stored)).toBe(false);
    expect(gate.verifyAccessCode("", stored)).toBe(false);
    expect(gate.verifyAccessCode("x".repeat(500), stored)).toBe(false);
    expect(gate.verifyAccessCode("lagune", "n'importe quoi")).toBe(false);
    expect(gate.hashAccessCode("même code")).not.toBe(gate.hashAccessCode("même code")); // sel aléatoire
  });

  it("exige un code seulement si un hachage valide est configuré", () => {
    expect(gate.codeRequired()).toBe(false);
    process.env.ADMIN_ACCESS_HASH = "pas-un-hash";
    expect(gate.codeRequired()).toBe(false);
    process.env.ADMIN_ACCESS_HASH = gate.hashAccessCode("code-secret-1234");
    expect(gate.codeRequired()).toBe(true);
  });

  it("lie le cookie de passage à l'adresse et au code : en changer un invalide les cookies déjà délivrés", () => {
    process.env.ADMIN_ACCESS_HASH = gate.hashAccessCode("premier-code-1111");
    const token = gate.gateToken("espace-exemple");
    expect(gate.cookieIsValid(token, "espace-exemple")).toBe(true);
    expect(gate.cookieIsValid(token, "autre-adresse")).toBe(false);
    expect(gate.cookieIsValid(undefined, "espace-exemple")).toBe(false);
    process.env.ADMIN_ACCESS_HASH = gate.hashAccessCode("second-code-2222");
    expect(gate.cookieIsValid(token, "espace-exemple")).toBe(false);
  });
});

describe("saisie du code", () => {
  it("accepte le bon code, refuse le mauvais, journalise tout, puis bloque l'adresse IP après 5 échecs", async () => {
    process.env.ADMIN_ACCESS_HASH = gate.hashAccessCode("bon-code-5555");
    const ip = "203.0.113.7";
    expect(await attempt.attemptGate("bon-code-5555", ip)).toEqual({ ok: true });
    for (let i = 0; i < attempt.GATE_MAX_PER_IP; i++) expect(await attempt.attemptGate(`mauvais-${i}`, ip)).toEqual({ ok: false, reason: "wrong" });
    // Au-delà : même le bon code est refusé depuis cette adresse (verrouillage)
    expect(await attempt.attemptGate("bon-code-5555", ip)).toEqual({ ok: false, reason: "locked" });
    // Une autre adresse n'est pas touchée par le verrou individuel
    expect(await attempt.attemptGate("bon-code-5555", "198.51.100.9")).toEqual({ ok: true });
    const logs = await ctx.db.adminAuditLog.findMany({ where: { action: { in: ["admin.gate", "admin.gate_failed"] } } });
    expect(logs.filter((l) => l.action === "admin.gate")).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toMatch(/bon-code|mauvais-/); // jamais le code saisi dans le journal
  });

  it("applique aussi un plafond global contre les attaques réparties sur plusieurs adresses", async () => {
    process.env.ADMIN_ACCESS_HASH = gate.hashAccessCode("autre-code-6666");
    const already = await ctx.db.adminAuditLog.count({ where: { action: "admin.gate_failed" } });
    for (let i = already; i < attempt.GATE_MAX_GLOBAL; i++) await attempt.attemptGate("faux", `192.0.2.${i}`);
    expect(await attempt.attemptGate("autre-code-6666", "192.0.2.250")).toEqual({ ok: false, reason: "locked" });
  });
});
