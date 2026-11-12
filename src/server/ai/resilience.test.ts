// Fiabilité des appels IA structurés : surcharge du fournisseur, JSON abîmé, réponse coupée. Le fournisseur est simulé
// au niveau HTTP (fetch) : ce sont bien les reprises, le repli de modèle et la réparation réels qui sont exercés.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let userId: string;
let structured: typeof import("./structured");
let provider: typeof import("./provider");

const schema = z.object({ questions: z.array(z.object({ slot: z.number(), statement: z.string() })) });
const answer = (text: string, finishReason = "STOP") => Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason }], modelVersion: "simulé" });
const overloaded = () => Response.json({ error: { message: "This model is currently experiencing high demand. Please try again later." } }, { status: 503 });
const modelOf = (url: unknown) => decodeURIComponent(String(url).split("/models/")[1].split(":")[0]);
const ask = () => structured.generateStructured({ userId, op: "exercise.generate_free", promptVersion: "test", system: "s", user: "u", schema, maxTokens: 1000 });

beforeAll(async () => {
  ctx = await startTestDb();
  process.env.GEMINI_API_KEY = "cle-de-test";
  process.env.GEMINI_MODEL = "modele-principal";
  process.env.GEMINI_FALLBACK_MODELS = "modele-de-repli";
  structured = await import("./structured");
  provider = await import("./provider");
  provider.aiRetry.delaysMs = [0, 0, 0];
  userId = (await ctx.db.user.create({ data: { email: "ia@niala.test", name: "IA", passwordHash: "x" } })).id;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await ctx.db.aIUsageLog.deleteMany();
});
afterAll(async () => {
  process.env.GEMINI_API_KEY = "";
  await ctx.stop();
});

describe("appels IA structurés : tenir malgré les défaillances du fournisseur", () => {
  it("modèle surchargé : nouveaux essais, puis repli sur un autre modèle, et la demande aboutit", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(modelOf(url));
      return modelOf(url) === "modele-principal" ? overloaded() : answer('{"questions": [{"slot": 1, "statement": "ok"}]}');
    }));
    const r = await ask();
    expect(r.data.questions).toHaveLength(1);
    expect(calls).toEqual(["modele-principal", "modele-principal", "modele-principal", "modele-principal", "modele-de-repli"]);
    const logs = await ctx.db.aIUsageLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].ok).toBe(true); // l'étudiant a obtenu sa réponse : ce n'est pas un échec
    expect(logs[0].error).toContain("Repli sur modele-de-repli");
  });

  it("surcharge passagère : le deuxième essai du même modèle suffit, sans repli", async () => {
    let n = 0;
    const fetchMock = vi.fn(async (_url: string) => (++n === 1 ? overloaded() : answer('{"questions": []}')));
    vi.stubGlobal("fetch", fetchMock);
    await ask();
    expect(fetchMock.mock.calls.map((c) => modelOf(c[0]))).toEqual(["modele-principal", "modele-principal"]);
  });

  it("tous les modèles surchargés : message actionnable, échec classé « surcharge »", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => overloaded()));
    const err = await ask().catch((e) => e);
    expect(err).toBeInstanceOf(provider.AiCallError);
    expect(err.kind).toBe("overload");
    expect(err.message).toContain("très sollicité");
    expect(err.message).toContain("réessayez dans une minute");
    const logs = await ctx.db.aIUsageLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].ok).toBe(false);
  });

  it("JSON abîmé par des formules : réparé localement, en un seul appel", async () => {
    const fetchMock = vi.fn(async (_url: string) => answer('{"questions": [{"slot": 1, "statement": "Calculer \\( \\sqrt{4} \\)"}]}'));
    vi.stubGlobal("fetch", fetchMock);
    const r = await ask();
    expect(r.data.questions[0].statement).toBe("Calculer \\( \\sqrt{4} \\)");
    expect(fetchMock).toHaveBeenCalledTimes(1); // avant : « Réponse invalide : JSON illisible », puis un second appel
    const logs = await ctx.db.aIUsageLog.findMany();
    expect(logs.map((l) => l.ok)).toEqual([true]);
  });

  it("réponse coupée : nouvel essai avec un budget doublé", async () => {
    const budgets: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const max = JSON.parse(init.body).generationConfig.maxOutputTokens as number;
      budgets.push(max);
      return max === 1000 ? answer('{"questions": [{"slot": 1, "statement": "Un"}, {"slot": 2, "statem', "MAX_TOKENS") : answer('{"questions": [{"slot": 1, "statement": "Un"}, {"slot": 2, "statement": "Deux"}]}');
    }));
    const r = await ask();
    expect(budgets).toEqual([1000, 2000]);
    expect(r.data.questions).toHaveLength(2);
  });

  it("réponse coupée deux fois : la partie complète est conservée plutôt que tout perdre", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer('{"questions": [{"slot": 1, "statement": "Un"}, {"slot": 2, "statem', "MAX_TOKENS")));
    const r = await ask();
    expect(r.data.questions.map((q) => q.slot)).toEqual([1]);
  });

  it("nouvel essai en panne après une réponse coupée : la partie déjà obtenue est renvoyée", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? answer('{"questions": [{"slot": 1, "statement": "Un"}, {"slot": 2, "st', "MAX_TOKENS") : overloaded())));
    const r = await ask();
    expect(r.data.questions.map((q) => q.slot)).toEqual([1]);
  });
});
