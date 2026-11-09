// Tests d'intégration des ateliers pratiques : sélection contrôlée de l'environnement, sauvegarde validée avec versions,
// correction (vérifications + IA), tuteur. Base PGlite réelle, fournisseur IA simulé.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider, CompletionRequest } from "@/server/ai/provider";

type Db = typeof import("@/lib/db").db;
let db: Db;
let gen: typeof import("./generation");
let att: typeof import("./attempts");
let tutor: typeof import("./tutor");
let rev: typeof import("@/server/services/workspaces/revisions");
let prov: typeof import("@/server/ai/provider");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string;
let calls: CompletionRequest[] = [];
let aiRatio = 0.9;

const MERISE_REF = {
  deliverables: ["mcd"],
  entities: [{ name: "Client", attributes: ["nom"], identifier: ["idClient"] }, { name: "Commande", attributes: ["date"], identifier: ["numCommande"] }],
  associations: [{ name: "Passer", links: [{ entity: "Client", card: "0,N" }, { entity: "Commande", card: "1,1" }] }],
};
const QUESTIONS: Record<string, object> = {
  merise: { type: "workspace", environment: "math", statement: "Concevoir le MCD d'une gestion de commandes : un client passe des commandes.", reference: "Client 0,N – Passer – 1,1 Commande", criteria: ["Entités", "Cardinalités"], structured: MERISE_REF, concepts: ["MCD"], explanation: "Voir le cours." },
  math: { type: "workspace", environment: "merise", statement: "Résoudre l'équation 2x + 3 = 7 et détailler les étapes.", reference: "x = 2", criteria: ["Étapes", "Résultat"], structured: { parts: [{ answers: ["2"] }] }, concepts: ["Équations"], explanation: "Voir le cours." },
  algo: { type: "workspace", environment: "algo", statement: "Écrire un algorithme qui calcule la somme des n premiers entiers.", reference: "Pour i de 1 à n : somme ← somme + i", criteria: ["Boucle", "Initialisation"], concepts: ["Boucles"], explanation: "Voir le cours." },
};
let kind: keyof typeof QUESTIONS = "merise";

const fake: AiProvider = {
  name: "fake",
  model: "fake-model",
  async complete(req) {
    calls.push(req);
    if (req.system.includes("Tu es le tuteur")) return { model: "fake-model", text: JSON.stringify({ message: "Regardez la cardinalité entre Client et Commande." }) };
    if (req.system.includes("Tu corriges la production")) return { model: "fake-model", text: JSON.stringify({ ratio: aiRatio, explanation: "Évaluation de test.", criteria: [{ label: "Entités", met: true }], missing: [], firstIncorrect: "", errorKind: "aucune" }) };
    const slots = JSON.parse(req.user.split("Créneaux à remplir :\n")[1].split("\n")[0]) as { slot: number }[];
    return { model: "fake-model", text: JSON.stringify({ questions: slots.map((s) => ({ ...QUESTIONS[kind], slot: s.slot })), insufficient: [] }) };
  },
};

beforeAll(async () => {
  pg = await PGlite.create();
  const root = path.join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(root).filter((n) => /^\d/.test(n) && !n.includes("v2_rls")).sort()) await pg.exec(readFileSync(path.join(root, name, "migration.sql"), "utf8"));
  const port = 61000 + Math.floor(Math.random() * 3000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-ws-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.GEMINI_API_KEY = "";
  db = (await import("@/lib/db")).db;
  gen = await import("./generation");
  att = await import("./attempts");
  tutor = await import("./tutor");
  rev = await import("@/server/services/workspaces/revisions");
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
  aiRatio = 0.9;
  prov.__setProviderForTests(fake);
});

const FREE = (subject: string, chapter: string) => ({ source: "free", subject, chapter, level: "L2", questionCount: 1, totalPoints: 10, types: ["workspace"], difficulty: "moyenne", correctionMode: "immediate", mode: "apprentissage" });
async function start(k: keyof typeof QUESTIONS, subject = "Systèmes d'information", chapter = "Modélisation") {
  kind = k;
  const r = await gen.generateFreeExercise(A, FREE(subject, chapter));
  const a = await att.startAttempt(A, r.id);
  return { exerciseId: r.id, attemptId: a.id };
}

const ent = (name: string, attrs: [string, boolean][]) => ({ id: `e-${name}`, name, x: 0, y: 0, attributes: attrs.map(([n, isId], i) => ({ id: `a-${name}${i}`, name: n, isId })) });
const exact = {
  mcd: {
    entities: [ent("Client", [["idClient", true], ["nom", false]]), ent("Commande", [["numCommande", true], ["date", false]])],
    associations: [{ id: "as1", name: "Passer", x: 0, y: 0, attributes: [], links: [{ id: "l1", entityId: "e-Client", card: "0,N" }, { id: "l2", entityId: "e-Commande", card: "1,1" }] }],
  },
};

describe("sélection de l'environnement", () => {
  it("le serveur corrige l'environnement proposé par l'IA quand la consigne est nette (Merise, mathématiques)", async () => {
    const m = await start("merise");
    expect((await att.getAttempt(A, m.attemptId)).questions[0].payload).toMatchObject({ environment: "merise", deliverables: expect.any(Array) });
    const x = await start("math", "Mathématiques", "Équations");
    expect((await att.getAttempt(A, x.attemptId)).questions[0].payload.environment).toBe("math");
  });
  it("laisse un algorithme dans l'éditeur algorithmique, sans exposer la référence au navigateur", async () => {
    const a = await start("algo");
    const q = (await att.getAttempt(A, a.attemptId)).questions[0];
    expect(q.payload.environment).toBe("algo");
    expect(JSON.stringify(q)).not.toContain("structured");
    expect(JSON.stringify(q)).not.toContain("somme ←");
  });
  it("transforme un exercice pratique de Merise généré comme tel en atelier", async () => {
    const { upgradeToWorkspace, buildQuestion } = await import("@/server/domain/exercise-model");
    const built = upgradeToWorkspace(buildQuestion({ slot: 1, type: "practical", statement: "Établir le MCD et le MLD correspondant à ce cas.", source: { quote: "x".repeat(15) }, concepts: [], reference: "ref de test", criteria: ["a", "b"] } as never));
    expect(built).toMatchObject({ type: "workspace", payload: { environment: "merise" } });
    const plain = upgradeToWorkspace(buildQuestion({ slot: 1, type: "practical", statement: "Expliquez le rôle de la mémoire cache.", source: { quote: "x".repeat(15) }, concepts: [], reference: "ref de test", criteria: ["a", "b"] } as never));
    expect(plain.type).toBe("practical");
  });
});

describe("sauvegarde et versions", () => {
  it("valide la production, refuse un document invalide ou trop gros, et garde des versions", async () => {
    const { attemptId } = await start("merise");
    await att.saveAnswer(A, attemptId, 1, exact);
    const saved = (await att.getAttempt(A, attemptId)).questions[0].answer as { mcd: { entities: unknown[] }; dictionary: unknown[] };
    expect(saved.mcd.entities).toHaveLength(2);
    expect(saved.dictionary).toEqual([]); // valeurs par défaut du schéma
    await expect(att.saveAnswer(A, attemptId, 1, { mcd: { entities: [{ id: "", name: "x" }] } })).rejects.toMatchObject({ status: 422 });
    await expect(att.saveAnswer(A, attemptId, 1, { dictionary: [{ id: "d", code: "x".repeat(300_000) }] })).rejects.toBeTruthy();
    const list = await rev.listRevisions(A, attemptId, 1);
    expect(list).toHaveLength(1); // une seule version automatique en moins de 2 minutes
    await att.saveAnswer(A, attemptId, 1, { ...exact, dictionary: [{ id: "d1", code: "nom" }] });
    expect(await rev.listRevisions(A, attemptId, 1)).toHaveLength(1);
    expect(await rev.recordRevision(A, attemptId, 1, { ...exact }, { force: true })).toBe(2);
    expect((await rev.getRevision(A, attemptId, 1, 1)).data).toMatchObject({ mcd: { entities: expect.any(Array) } });
    await expect(rev.getRevision(B, attemptId, 1, 1)).rejects.toMatchObject({ status: 404 });
  });
});

describe("correction", () => {
  it("note pleine pour une modélisation exacte, avec le détail des vérifications", async () => {
    const { attemptId } = await start("merise");
    await att.saveAnswer(A, attemptId, 1, exact);
    const r = await att.submitAttempt(A, attemptId);
    const res = r.questions[0].result!;
    expect(res.points).toBe(10);
    expect(res.detail).toMatchObject({ workspace: true, environment: "merise", scores: { checks: 1 } });
    expect((res.detail as { checks: { ok: boolean }[] }).checks.every((c) => c.ok)).toBe(true);
  });
  it("retire des points pour une erreur de cardinalité et l'explique", async () => {
    aiRatio = 0.3;
    const { attemptId } = await start("merise");
    const wrong = { mcd: { ...exact.mcd, associations: [{ ...exact.mcd.associations[0], links: [{ id: "l1", entityId: "e-Client", card: "0,N" }, { id: "l2", entityId: "e-Commande", card: "0,N" }] }] } };
    await att.saveAnswer(A, attemptId, 1, wrong);
    const res = (await att.submitAttempt(A, attemptId)).questions[0].result!;
    expect(res.points).toBeLessThan(10);
    expect(res.points).toBeGreaterThan(0);
    expect(JSON.stringify(res.detail)).toContain("0,N au lieu de 1,1");
  });
  it("l'IA peut relever la note d'une solution différente mais valable, sans passer sous les vérifications", async () => {
    aiRatio = 1;
    const { attemptId } = await start("merise");
    const other = { mcd: { entities: [ent("Acheteur", [["code", true]]), ent("Achat", [["ref", true]])], associations: [{ id: "x", name: "Effectuer", x: 0, y: 0, attributes: [], links: [{ id: "k1", entityId: "e-Acheteur", card: "0,N" }, { id: "k2", entityId: "e-Achat", card: "1,1" }] }] } };
    await att.saveAnswer(A, attemptId, 1, other);
    const res = (await att.submitAttempt(A, attemptId)).questions[0].result!;
    expect(res.points).toBeGreaterThanOrEqual(6); // 0,6 × IA : la référence structurée seule aurait donné moins
    const scores = (res.detail as { scores: { checks: number; qualitative: number } }).scores;
    expect(scores.qualitative).toBe(1);
    expect(res.points!).toBeGreaterThanOrEqual(scores.checks * 10);
  });
  it("corrige une résolution mathématique : résultat et étapes, première étape fausse signalée", async () => {
    aiRatio = 0.5;
    const { attemptId } = await start("math", "Mathématiques", "Équations");
    const step = (id: string, a: string) => ({ id, latex: a, ascii: a, note: "" });
    await att.saveAnswer(A, attemptId, 1, { parts: [{ id: "p", label: "Q1", steps: [step("1", "2x+3=7"), step("2", "2x=10"), step("3", "x=5")], result: { latex: "x=5", ascii: "x=5" } }] });
    const res = (await att.submitAttempt(A, attemptId)).questions[0].result!;
    expect(res.points).toBeLessThan(5);
    expect((res.detail as { firstIncorrect?: string }).firstIncorrect).toBeTruthy();
    expect(JSON.stringify(res.detail)).toContain("résultat final");
  });
  it("laisse un algorithme sans note quand l'IA est indisponible, puis le corrige", async () => {
    const { attemptId } = await start("algo");
    await att.saveAnswer(A, attemptId, 1, { language: "pseudo", code: "Algorithme S\nDébut\n  s ← 0\nFin", stdin: "", lastRun: null });
    prov.__setProviderForTests(null);
    expect((await att.submitAttempt(A, attemptId)).questions[0].result?.verdict).toBe("ungraded");
    prov.__setProviderForTests(fake);
    const again = await att.regradePending(A, attemptId);
    expect(again.questions[0].result?.method).toBe("ai");
  });
  it("traite un atelier vide comme sans réponse", async () => {
    const { attemptId } = await start("merise");
    await att.saveAnswer(A, attemptId, 1, {});
    expect((await att.submitAttempt(A, attemptId)).questions[0].result?.verdict).toBe("skipped");
  });
});

describe("tuteur dans un atelier", () => {
  it("propose « Vérifier mon travail » et lui transmet la production et les contrôles automatiques", async () => {
    const { attemptId } = await start("merise");
    const noId = { mcd: { entities: [ent("Client", [["nom", false]])], associations: [] } };
    expect((await tutor.tutorState(A, attemptId, 1)).allowed).toContain("check");
    await tutor.askTutor(A, attemptId, { position: 1, kind: "check", answer: noId });
    const prompt = calls.at(-1)!.user;
    expect(prompt).toContain("Production actuelle de l'étudiant dans l'atelier (merise)");
    expect(prompt).toContain("MCD entités : Client (nom)");
    expect(prompt).toContain("n'a pas d'identifiant");
  });
});
