// Détection des anomalies sur une vraie base PGlite : classement par priorité, seuils par type de route et prompts exploitables.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let mod: typeof import("@/server/admin/anomalies");

beforeAll(async () => {
  ctx = await startTestDb();
  mod = await import("@/server/admin/anomalies");
}, 120_000);

afterAll(async () => {
  await ctx?.stop();
});

describe("anomalies de la plateforme", () => {
  it("renvoie une liste vide sans mesure, jamais d'anomalie inventée", async () => {
    const r = await mod.getAnomalies(7);
    expect(r.anomalies).toEqual([]);
    expect(r.masterPrompt).toMatch(/Aucune anomalie/);
  });

  it("classe par priorité, applique un seuil propre aux opérations longues et produit un prompt complet", async () => {
    await ctx.db.requestLog.createMany({
      data: [
        // Lecture très sollicitée et lente : doit sortir en tête.
        ...Array.from({ length: 30 }, (_, i) => ({ route: "/api/dashboard", method: "GET", status: 200, durationMs: 5000 + i * 100, module: "dashboard" })),
        // Import (opération longue) à 12 s : sous son seuil de 20 s, donc pas une anomalie.
        ...Array.from({ length: 5 }, () => ({ route: "/api/agenda/imports", method: "POST", status: 200, durationMs: 12_000, module: "agenda" })),
        // Route rapide : aucune anomalie.
        ...Array.from({ length: 20 }, () => ({ route: "/api/subjects", method: "GET", status: 200, durationMs: 90, module: "subjects" })),
        // Erreurs serveur répétées.
        ...Array.from({ length: 8 }, () => ({ route: "/api/files/:id/text", method: "GET", status: 500, durationMs: 300, module: "documents", errorKind: "APP", errorSummary: "Error" })),
        // Erreur de saisie banale (401) : ignorée.
        ...Array.from({ length: 30 }, () => ({ route: "/api/auth/login", method: "POST", status: 401, durationMs: 50, module: "account", errorKind: "USER" })),
      ],
    });
    await ctx.db.aIUsageLog.createMany({ data: Array.from({ length: 6 }, (_, i) => ({ op: "generation", model: "m1", ok: i < 2, error: i < 2 ? null : "timeout", durationMs: 1000 })) });
    await ctx.db.adminAlert.create({ data: { key: "errors.rate", severity: "CRITICAL", title: "Taux d'erreurs serveur élevé", detail: "7 erreurs" } });

    const r = await mod.getAnomalies(7);
    const titles = r.anomalies.map((a) => a.title);

    expect(titles).toContain("Route lente : GET /api/dashboard");
    expect(titles.some((t) => t.includes("/api/agenda/imports"))).toBe(false);
    expect(titles.some((t) => t.includes("/api/subjects"))).toBe(false);
    expect(titles.some((t) => t.includes("/api/auth/login"))).toBe(false);
    expect(titles).toContain("Erreur serveur 500 récurrente : GET /api/files/:id/text");
    expect(titles).toContain("Échecs d'appels IA : opération « generation »");
    expect(titles).toContain("Alerte ouverte : Taux d'erreurs serveur élevé");

    // Classement : scores décroissants, priorité cohérente avec le score.
    const scores = r.anomalies.map((a) => a.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(r.anomalies[0].priority).toBe("P1");
    expect(r.anomalies.every((a) => ["P1", "P2", "P3", "P4"].includes(a.priority))).toBe(true);

    const slow = r.anomalies.find((a) => a.title === "Route lente : GET /api/dashboard")!;
    expect(slow.files).toEqual(["src/app/api/dashboard/route.ts"]);
    expect(slow.prompt).toContain("## Constat mesuré");
    expect(slow.prompt).toContain("## À faire");
    expect(slow.prompt).toContain("préserver toutes les fonctionnalités existantes");
    expect(slow.prompt).toContain("30 appels");

    // Le prompt d'ensemble numérote les tâches dans l'ordre du classement.
    expect(r.masterPrompt).toContain(`1. [${r.anomalies[0].priority}] ${r.anomalies[0].title}`);
    expect(r.masterPrompt).toContain(`## Tâche ${r.anomalies.length} / ${r.anomalies.length}`);
  });

  it("transforme une route paramétrée en chemin de fichier", () => {
    expect(mod.routeFile("/api/files/:id/analysis")).toBe("src/app/api/files/[id]/analysis/route.ts");
  });
});
