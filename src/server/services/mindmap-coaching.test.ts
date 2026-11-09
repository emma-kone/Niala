// Tests d'intégration : cartes mentales générées par l'IA (avec et sans matière) et conseils pédagogiques d'après les données réelles.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider, CompletionRequest } from "@/server/ai/provider";

type Db = typeof import("@/lib/db").db;
let db: Db;
let docs: typeof import("@/server/services/documents");
let maps: typeof import("@/server/services/maps");
let mapsAi: typeof import("@/server/services/maps-ai");
let coaching: typeof import("@/server/services/progress/coaching");
let prov: typeof import("@/server/ai/provider");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string;
let calls: CompletionRequest[] = [];

const COURS = `Chapitre 1 : les fonctions. Une fonction est un bloc de code reutilisable que l'on appelle par son nom. Les parametres permettent de transmettre des valeurs a la fonction.
Chapitre 2 : la recursivite. Une fonction recursive est une fonction qui s'appelle elle-meme jusqu'a une condition d'arret. La pile d'appels garde la trace de chaque appel en attente.
Chapitre 3 : les tableaux. Un tableau est une suite d'elements de meme type accessibles par leur indice. Le parcours d'un tableau utilise une boucle.`;

const MAP = {
  title: "Les fonctions",
  nodes: [
    { id: "r", label: "Fonctions", parent: null, kind: "theme" },
    { id: "a", label: "Définition", parent: "r", kind: "definition", detail: "Une fonction est un bloc de code reutilisable que l'on appelle par son nom" },
    { id: "b", label: "Paramètres", parent: "a", kind: "concept", detail: "transmettre des valeurs a la fonction" },
    { id: "c", label: "Récursivité", parent: "r", kind: "chapter", detail: "fonction qui s'appelle elle-meme jusqu'a une condition d'arret" },
    { id: "d", label: "Pile d'appels", parent: "c", kind: "concept" },
    { id: "e", label: "Thermodynamique", parent: "r", kind: "chapter" },
  ],
  links: [{ from: "d", to: "b", type: "RELATED", label: "utilise" }],
};

const fake: AiProvider = {
  name: "fake",
  model: "fake-model",
  async complete(req) {
    calls.push(req);
    if (req.system.includes("conseiller pédagogique")) {
      const keys = [...req.user.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1]);
      return { model: "fake-model", text: JSON.stringify({ items: [...keys.map((key) => ({ key, advice: "Relisez la notion puis refaites un exercice court." })), { key: "inconnue", advice: "Conseil sans observation." }] }) };
    }
    return { model: "fake-model", text: JSON.stringify(MAP) };
  },
};

beforeAll(async () => {
  pg = await PGlite.create();
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(root).filter((n) => /^\d/.test(n) && !n.includes("v2_rls")).sort()) await pg.exec(readFileSync(path.join(root, name, "migration.sql"), "utf8"));
  const port = 58000 + Math.floor(Math.random() * 3000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-mm-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.GEMINI_API_KEY = "";
  db = (await import("@/lib/db")).db;
  docs = await import("@/server/services/documents");
  maps = await import("@/server/services/maps");
  mapsAi = await import("@/server/services/maps-ai");
  coaching = await import("@/server/services/progress/coaching");
  prov = await import("@/server/ai/provider");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x", settings: { create: {} } } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x", settings: { create: {} } } })).id;
}, 120_000);

afterAll(async () => {
  prov?.__setProviderForTests(undefined);
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  prov.__setProviderForTests(fake);
});

async function uploadText(user: string, subjectId: string | null) {
  const data = Buffer.from(COURS, "utf8");
  const [r] = await docs.prepareUploads(user, { subjectId, folderId: null, files: [{ name: "cours.txt", size: data.length }] });
  if (!r.ok) throw new Error(r.error);
  await docs.receiveLocalUpload(user, r.versionId, data);
  await docs.finalizeUpload(user, r.versionId);
  return r.documentId;
}

describe("carte mentale générée par l'IA", () => {
  it("crée une carte éditable depuis un texte, sans matière ni cours enregistré", async () => {
    const r = await mapsAi.generateMindMapFromContent(A, { text: COURS });
    expect(r).toMatchObject({ subjectId: null, nodes: 6, links: 1 });
    const map = await maps.getMap(A, r.id);
    expect(map.subjectId).toBeNull();
    expect(map.nodes).toHaveLength(6);
    expect(map.edges.filter((e) => e.type === "PART_OF")).toHaveLength(5);
    expect(map.nodes.find((n) => n.label === "Définition")).toMatchObject({ origin: "DOCUMENT", data: { definition: expect.stringContaining("bloc de code") } });
    expect(map.nodes.find((n) => n.label === "Thermodynamique")?.origin).toBe("AI_INFERRED"); // rien ne le rattache au texte du cours
    expect(new Set(map.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(6); // disposition calculée
  });
  it("garde la définition d'un nœud après modification et enregistrement", async () => {
    const { id } = await mapsAi.generateMindMapFromContent(A, { text: COURS });
    const map = await maps.getMap(A, id);
    const nodes = map.nodes.map((n) => ({ id: n.id, label: n.label === "Thermodynamique" ? "Chaleur" : n.label, x: n.x + 10, y: n.y, origin: n.origin, data: {} }));
    const extra = { id: "nnouveau0001", label: "Branche ajoutée", x: 0, y: 0, origin: "USER" as const, data: {} };
    const edges = [...map.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type, label: e.label, origin: e.origin })), { id: "enouveau0001", source: extra.id, target: map.nodes[0].id, type: "PART_OF" as const, label: null, origin: "USER" as const }];
    await maps.saveMap(A, id, { revision: map.revision, title: map.title, nodes: [...nodes, extra], edges });
    const after = await maps.getMap(A, id);
    expect(after.nodes).toHaveLength(7);
    expect(after.nodes.find((n) => n.label === "Définition")?.data?.definition).toContain("bloc de code");
    expect(after.nodes.find((n) => n.label === "Chaleur")?.data?.edited).toBe(true);
  });
  it("part d'un cours importé sans matière, par plage de pages, et le retrouve dans la liste", async () => {
    const documentId = await uploadText(A, null);
    const r = await mapsAi.generateMindMapFromContent(A, { documentId });
    expect(calls.at(-1)!.user).toContain("Chapitre 2");
    expect(r.subjectId).toBeNull();
    const list = await maps.listAllMaps(A, { documentId });
    expect(list).toHaveLength(1);
    expect(list[0].document?.id).toBe(documentId);
    expect((await maps.getMap(A, r.id)).document?.id).toBe(documentId);
  });
  it("rattache la carte à la matière du cours", async () => {
    const s = await db.subject.create({ data: { userId: A, name: "Algo" } });
    const documentId = await uploadText(A, s.id);
    expect((await mapsAi.generateMindMapFromContent(A, { documentId })).subjectId).toBe(s.id);
  });
  it("refuse un contenu trop court, vide, ou le cours d'un autre compte", async () => {
    await expect(mapsAi.generateMindMapFromContent(A, { text: "trop court" })).rejects.toMatchObject({ status: 422 });
    await expect(mapsAi.generateMindMapFromContent(A, {})).rejects.toMatchObject({ status: 422 });
    const documentId = await uploadText(A, null);
    await expect(mapsAi.generateMindMapFromContent(B, { documentId })).rejects.toMatchObject({ status: 404 });
    await expect(maps.getMap(B, (await maps.listAllMaps(A))[0].id)).rejects.toMatchObject({ status: 404 });
  });
  it("signale une réponse inexploitable de l'IA sans rien enregistrer", async () => {
    const before = await db.mindMap.count();
    prov.__setProviderForTests({ ...fake, complete: async () => ({ model: "fake-model", text: "pas du json" }) });
    await expect(mapsAi.generateMindMapFromContent(A, { text: COURS })).rejects.toBeTruthy();
    expect(await db.mindMap.count()).toBe(before);
  });
});

// ── Conseils pédagogiques : données réelles en base ──
async function makeAttempt(userId: string, exercise: { id: string; title: string }, verdicts: string[], when: Date, status: "GRADED" | "IN_PROGRESS" = "GRADED") {
  const questions = verdicts.map((_, i) => ({ position: i + 1, type: "short_answer", points: 1, difficulty: "moyenne", payload: { statement: `Q${i + 1}` }, answerKey: {}, explanation: null, sourceRefs: [], concepts: [{ id: "cp1", name: "Pointeurs" }] }));
  const snapshot = { exercise: { id: exercise.id, title: exercise.title, subjectId: null, documentId: null }, questions };
  const ok = verdicts.filter((v) => v === "correct").length;
  const a = await db.exerciseAttempt.create({ data: { userId, exerciseId: exercise.id, snapshot, status, startedAt: when, finishedAt: status === "GRADED" ? when : null, score: ok, maxScore: verdicts.length, durationSec: 300 } });
  await db.answer.createMany({ data: verdicts.map((v, i) => ({ userId, attemptId: a.id, position: i + 1, value: "x", verdict: v, points: v === "correct" ? 1 : 0, feedback: { verdict: v } })) });
  await db.exerciseAttempt.update({ where: { id: a.id }, data: { updatedAt: when } });
  return a;
}

describe("conseils pédagogiques", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  let C: string;
  beforeAll(async () => {
    C = (await db.user.create({ data: { email: "c@x.fr", passwordHash: "x", settings: { create: { weeklyGoal: 3 } } } })).id;
  });

  it("dit que les données sont insuffisantes pour un nouveau compte", async () => {
    const r = await coaching.getCoaching(C);
    expect(r.status).toBe("insufficient");
    expect(r.insights).toEqual([]);
  });

  it("repère une difficulté persistante sur plusieurs sessions, avec ses preuves", async () => {
    const ex = await db.exercise.create({ data: { userId: C, title: "Pointeurs 1", totalPoints: 5, config: {} } });
    await makeAttempt(C, ex, ["incorrect", "incorrect", "correct"], daysAgo(6));
    const second = await makeAttempt(C, ex, ["incorrect", "partial", "incorrect"], daysAgo(1));
    await db.attemptTutorMessage.createMany({ data: [1, 1, 2, 2, 3].map((position) => ({ userId: C, attemptId: second.id, position, role: "USER" as const, kind: "hint", content: "indice" })) });
    const r = await coaching.getCoaching(C);
    expect(r.status).toBe("ok");
    const keys = r.insights.map((i) => i.key);
    expect(r.insights.find((i) => i.category === "ALERT")).toBeTruthy();
    expect(keys.some((k) => k.startsWith("retry:"))).toBe(true); // dernier résultat < 50 %
    expect(r.insights.find((i) => i.key === "retry:" + ex.id)?.actions[0].href).toBe(`/exercices/${ex.id}`);
  });

  it("propose de reprendre un exercice abandonné, et l'écarte sur demande pendant 7 jours", async () => {
    const ex = await db.exercise.create({ data: { userId: C, title: "Listes", totalPoints: 5, config: {} } });
    const t = await makeAttempt(C, ex, ["correct", "correct", "correct", "correct"], daysAgo(5), "IN_PROGRESS");
    await db.answer.deleteMany({ where: { attemptId: t.id, position: { in: [3, 4] } } });
    const before = await coaching.getCoaching(C);
    const resume = before.insights.find((i) => i.key === `resume:${t.id}`);
    expect(resume?.actions[0].href).toBe(`/exercices/${ex.id}/tentatives/${t.id}`);
    await coaching.dismissInsight(C, `resume:${t.id}`);
    expect((await coaching.getCoaching(C)).insights.some((i) => i.key === `resume:${t.id}`)).toBe(false);
    await db.coachDismissal.updateMany({ where: { userId: C }, data: { until: daysAgo(1) } });
    expect((await coaching.getCoaching(C)).insights.some((i) => i.key === `resume:${t.id}`)).toBe(true);
  });

  it("suit l'objectif hebdomadaire", async () => {
    // Fin de semaine : moins de 3 exercices terminés, l'objectif de 3 est signalé comme en retard.
    const friday = new Date(new Date().setHours(0, 0, 0, 0) - ((new Date().getDay() + 6) % 7) * 86_400_000 + 5 * 86_400_000 + 3_600_000);
    const r = await coaching.getCoaching(C, { max: 12, now: friday });
    expect(r.insights.find((i) => i.key === "goal:behind")?.evidence[0].value).toMatch(/sur 3$/);
  });

  it("l'IA ne reformule que les observations existantes, et le résultat est gardé en mémoire", async () => {
    const first = await coaching.adviceFor(C);
    expect(first.available).toBe(true);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.some((i) => i.key === "inconnue")).toBe(false);
    const n = calls.length;
    await coaching.adviceFor(C);
    expect(calls.length).toBe(n);
  });

  it("isole les conseils par compte", async () => {
    expect((await coaching.getCoaching(B)).insights.some((i) => i.key.startsWith("retry:"))).toBe(false);
  });
});
