// Tests d'intégration du chat : vrai Prisma sur PGlite (migrations réelles), faux fournisseur déterministe.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider, ChatTurn, ConverseRequest } from "@/server/ai/provider";
import { WebSearchUnavailableError, __setWebSearcherForTests } from "@/server/ai/web-search";
import type { ChatEvent } from "./chat";

let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let db: typeof import("@/lib/db").db;
let docs: typeof import("@/server/services/documents");
let chat: typeof import("./chat");
let prov: typeof import("@/server/ai/provider");
let A: string;
let B: string;
let subj: string;
let docCours: string;
let docAutre: string;
let docB: string;

let verifier: () => unknown = () => {
  throw new Error("vérificateur indisponible");
};
const seen: ConverseRequest[] = [];
let script: (req: ConverseRequest, step: number) => { text?: string; calls?: { name: string; args: Record<string, unknown> }[] } = () => ({ text: "ok" });

function vec(text: string): number[] {
  const v = new Array(16).fill(0);
  for (const w of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (w.length < 3) continue;
    let h = 0;
    for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) % 16;
    v[h] += 1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

const fake: AiProvider = {
  name: "fake",
  model: "fake-1",
  embeddingModel: "fake-embed",
  async complete() {
    return { text: JSON.stringify(verifier()), model: "fake-1" };
  },
  async embed(texts) {
    return texts.map(vec);
  },
  async converse(req) {
    seen.push(req);
    const step = req.turns.filter((t: ChatTurn) => t.role === "model").length;
    const r = script(req, step);
    if (r.text) req.onText?.(r.text);
    const parts = r.calls ? r.calls.map((c) => ({ functionCall: c })) : [{ text: r.text ?? "" }];
    return { text: r.text ?? "", calls: r.calls ?? [], modelParts: parts, model: "fake-1" };
  },
};

const migrations = path.join(process.cwd(), "prisma", "migrations");

async function importText(user: string, name: string, content: string) {
  const data = Buffer.from(content);
  const [r] = await docs.prepareUploads(user, { subjectId: user === A ? subj : (await db.subject.findFirstOrThrow({ where: { userId: user } })).id, folderId: null, files: [{ name, size: data.length }] });
  if (!r.ok) throw new Error(r.error);
  await docs.receiveLocalUpload(user, r.versionId, data);
  const fin = await docs.finalizeUpload(user, r.versionId);
  return fin.documentId;
}

beforeAll(async () => {
  pg = await PGlite.create();
  for (const name of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261109000000_niala_reliability"]) {
    await pg.exec(readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
  }
  const port = 30000 + Math.floor(Math.random() * 10000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "niala-chat-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.GEMINI_API_KEY = "";
  db = (await import("@/lib/db")).db;
  docs = await import("@/server/services/documents");
  chat = await import("./chat");
  prov = await import("@/server/ai/provider");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
  subj = (await db.subject.create({ data: { userId: A, name: "Algo" } })).id;
  await db.subject.create({ data: { userId: B, name: "Réseaux" } });
  docCours = await importText(A, "recursivite.txt", "La récursivité est une technique où une fonction s'appelle elle-même. Chaque appel empile un cadre sur la pile d'appels. Une condition d'arrêt est indispensable.");
  docAutre = await importText(A, "tris.txt", "Le tri fusion divise la liste en deux moitiés, trie chacune récursivement puis fusionne. Sa complexité est en n log n pour tous les cas.");
  docB = await importText(B, "secret.txt", "Document confidentiel de B : le protocole TCP établit une connexion en trois temps (handshake).");
  prov.__setProviderForTests(fake);
}, 90_000);

afterAll(async () => {
  prov?.__setProviderForTests(undefined);
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("génération : interruption, relance et contexte", () => {
  const newConversation = async () => (await chat.createConversation(A, { scope: "GLOBAL" })).id;
  const stored = async (id: string) => (await chat.getConversation(A, id)).messages.map((m) => [m.role, m.content]);

  it("conserve le texte déjà rédigé quand l'étudiant interrompt", async () => {
    const stop = new AbortController();
    const id = await newConversation();
    const original = fake.converse!;
    fake.converse = async (req) => {
      req.onText?.("Début de réponse");
      stop.abort();
      throw new Error("aborted");
    };
    try {
      const r = await chat.sendMessage(A, id, "Question longue", { signal: stop.signal, emit: () => undefined });
      expect(r.message.content).toBe("Début de réponse");
      expect((r.message.consulted as { interrupted?: boolean }).interrupted).toBe(true);
      expect(await stored(id)).toEqual([["USER", "Question longue"], ["ASSISTANT", "Début de réponse"]]);
    } finally {
      fake.converse = original;
    }
  });

  it("interruption avant tout texte : aucune réponse enregistrée, la question reste", async () => {
    const stop = new AbortController();
    const id = await newConversation();
    const original = fake.converse!;
    fake.converse = async () => {
      stop.abort();
      throw new Error("aborted");
    };
    try {
      await expect(chat.sendMessage(A, id, "Question", { signal: stop.signal })).rejects.toMatchObject({ status: chat.INTERRUPTED_STATUS });
      expect(await stored(id)).toEqual([["USER", "Question"]]);
    } finally {
      fake.converse = original;
    }
  });

  it("relancer remplace la dernière réponse sans dupliquer la question", async () => {
    const id = await newConversation();
    script = () => ({ text: "Première réponse" });
    await chat.sendMessage(A, id, "Ma question");
    script = () => ({ text: "Deuxième réponse" });
    await chat.sendMessage(A, id, await chat.takeLastTurn(A, id));
    expect(await stored(id)).toEqual([["USER", "Ma question"], ["ASSISTANT", "Deuxième réponse"]]);
    await expect(chat.takeLastTurn(B, id)).rejects.toMatchObject({ status: 404 });
  });

  it("limite un message aux documents choisis, sans ouvrir ceux d'un autre étudiant", async () => {
    const id = await newConversation();
    seen.length = 0;
    script = () => ({ text: "Ok" });
    await chat.sendMessage(A, id, "Résume", { documentIds: [docCours, docB] });
    const system = seen[0].system;
    expect(system).toContain("recursivite");
    expect(system).not.toContain("tris");
    expect(system).not.toContain("secret");
  });

  it("le registre des générations n'interrompt que celles de leur propriétaire", async () => {
    const { beginTurn, stopTurn } = await import("./turns");
    const turn = beginTurn("conv-1", A);
    expect(stopTurn("conv-1", B)).toBe(false);
    expect(turn.signal.aborted).toBe(false);
    expect(stopTurn("conv-1", A)).toBe(true);
    expect(turn.signal.aborted).toBe(true);
    turn.end();
    expect(stopTurn("conv-1", A)).toBe(false);
  });
});

describe("conversations : propriété et isolement", () => {
  it("crée, liste, renomme et supprime ; un autre utilisateur ne voit rien", async () => {
    const c = await chat.createConversation(A, { scope: "DOCUMENT", documentId: docCours });
    expect(c.title).toBe("Nouvelle conversation");
    expect((await chat.listConversations(A, "DOCUMENT", docCours)).map((x) => x.id)).toContain(c.id);
    expect(await chat.listConversations(B, "DOCUMENT", docCours)).toEqual([]);
    await expect(chat.getConversation(B, c.id)).rejects.toMatchObject({ status: 404 });
    await expect(chat.renameConversation(B, c.id, "x")).rejects.toMatchObject({ status: 404 });
    await expect(chat.deleteConversation(B, c.id)).rejects.toMatchObject({ status: 404 });
    await expect(chat.sendMessage(B, c.id, "salut")).rejects.toMatchObject({ status: 404 });
    await expect(chat.createConversation(B, { scope: "DOCUMENT", documentId: docCours })).rejects.toMatchObject({ status: 404 });
    await expect(chat.createConversation(B, { scope: "GLOBAL", subjectId: subj })).rejects.toMatchObject({ status: 404 });
    await expect(chat.createConversation(A, { scope: "DOCUMENT" })).rejects.toMatchObject({ status: 422 });
    await chat.renameConversation(A, c.id, "  Ma récursivité ");
    expect((await chat.getConversation(A, c.id)).conversation.title).toBe("Ma récursivité");
    await chat.deleteConversation(A, c.id);
    await expect(chat.getConversation(A, c.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("chat de document", () => {
  let conv: string;

  it("recherche dans le cours, répond avec des références vérifiées et vectorise les passages", async () => {
    seen.length = 0;
    script = (_req, step) =>
      step === 0
        ? { calls: [{ name: "search_passages", args: { query: "récursivité pile d'appels" } }] }
        : { text: "La récursivité empile des appels [1]. Fait inventé [9]." };
    conv = (await chat.createConversation(A, { scope: "DOCUMENT", documentId: docCours })).id;
    const r = await chat.sendMessage(A, conv, "Explique la récursivité");
    expect(r.message.content).toBe("La récursivité empile des appels [1]. Fait inventé.");
    expect(r.message.citations).toHaveLength(1);
    expect(r.message.citations[0]).toMatchObject({ n: 1, documentId: docCours, documentName: "recursivite" });
    expect(r.message.citations[0].quote).toContain("récursivité");
    expect(r.title).toBe("Explique la récursivité");
    // les passages ont été vectorisés au passage
    const v = (await db.document.findUniqueOrThrow({ where: { id: docCours } })).currentVersionId!;
    expect(await db.documentChunk.count({ where: { versionId: v, embeddingModel: "fake-embed" } })).toBeGreaterThan(0);
    // l'extrait renvoyé au modèle est encadré comme donnée non fiable
    const toolTurn = seen[1].turns.at(-1)!.parts[0] as { functionResponse: { response: { extraits: string } } };
    expect(toolTurn.functionResponse.response.extraits).toMatch(/<DOC-[0-9a-f]{16} /);
    // la couverture réelle est fournie au modèle
    expect(seen[0].system).toContain("extraction complète");
  });

  it("garde l'historique et le contexte d'une conversation, sans fuite vers une autre", async () => {
    script = () => ({ text: "Réponse 2" });
    seen.length = 0;
    await chat.sendMessage(A, conv, "Et un exemple ?");
    expect(seen[0].turns.map((t) => (t.parts[0] as { text: string }).text)).toEqual(["Explique la récursivité", "La récursivité empile des appels [1]. Fait inventé.", "Et un exemple ?"]);
    const other = await chat.createConversation(A, { scope: "DOCUMENT", documentId: docCours });
    seen.length = 0;
    await chat.sendMessage(A, other.id, "Nouvelle question");
    expect(seen[0].turns).toHaveLength(1);
    expect((await chat.getConversation(A, conv)).messages).toHaveLength(4);
  });

  it("ne peut jamais lire un autre document, même si le modèle en vise un", async () => {
    seen.length = 0;
    script = (_req, step) =>
      step === 0
        ? { calls: [{ name: "read_pages", args: { document_id: docAutre, from: 1 } }, { name: "search_passages", args: { query: "tri fusion complexité", document_id: docAutre } }, { name: "read_pages", args: { document_id: docB, from: 1 } }] }
        : { text: "Voilà [1] [2]." };
    const c = await chat.createConversation(A, { scope: "DOCUMENT", documentId: docCours });
    const r = await chat.sendMessage(A, c.id, "Parle du tri fusion");
    expect(r.message.citations.every((x) => x.documentId === docCours)).toBe(true);
    const out = JSON.stringify(seen[1].turns.at(-1));
    expect(out).not.toContain("tri fusion divise");
    expect(out).not.toContain("confidentiel");
  });

  it("signale une extraction partielle au modèle", async () => {
    const v = (await db.document.findUniqueOrThrow({ where: { id: docAutre } })).currentVersionId!;
    await db.documentVersion.update({ where: { id: v }, data: { extractStatus: "PARTIAL" } });
    seen.length = 0;
    script = () => ({ text: "ok" });
    const c = await chat.createConversation(A, { scope: "DOCUMENT", documentId: docAutre });
    const r = await chat.sendMessage(A, c.id, "Résume tout");
    expect(seen[0].system).toContain("extraction PARTIELLE");
    expect(JSON.stringify(r.message.consulted)).toContain('"complete":false');
  });
});

describe("chat global", () => {
  it("voit toute la bibliothèque de l'utilisateur et seulement elle", async () => {
    seen.length = 0;
    script = (_req, step) =>
      step === 0
        ? { calls: [{ name: "list_documents", args: {} }, { name: "search_passages", args: { query: "récursivement fusion pile" } }] }
        : { text: "Synthèse [1] [2]." };
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    const r = await chat.sendMessage(A, c.id, "Compare récursivité et tri fusion");
    const names = r.message.citations.map((x) => x.documentName).sort();
    expect(names).toEqual(["recursivite", "tris"]);
    const listed = JSON.stringify(seen[1].turns.at(-1));
    expect(listed).toContain("recursivite");
    expect(listed).not.toContain("secret");
    expect(JSON.stringify(seen[1].turns.at(-1))).not.toContain("confidentiel");
    expect((await chat.listConversations(A, "GLOBAL")).map((x) => x.id)).toContain(c.id);
    expect((await chat.listConversations(A, "DOCUMENT", docCours)).map((x) => x.id)).not.toContain(c.id);
  });

  it("une matière ciblée limite la recherche à cette matière", async () => {
    const other = await db.subject.create({ data: { userId: A, name: "Vide" } });
    seen.length = 0;
    script = () => ({ text: "ok" });
    const c = await chat.createConversation(A, { scope: "GLOBAL", subjectId: other.id });
    await chat.sendMessage(A, c.id, "Bonjour");
    expect(seen[0].system).toContain("0 document(s) consultables");
  });
});

describe("sans fournisseur", () => {
  it("refuse proprement (503) et conserve la conversation", async () => {
    prov.__setProviderForTests(null);
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    await expect(chat.sendMessage(A, c.id, "Bonjour")).rejects.toMatchObject({ status: 503 });
    prov.__setProviderForTests(fake);
  });
  it("une panne du modèle ne perd pas le message de l'utilisateur", async () => {
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    script = () => {
      throw new Error("panne");
    };
    await expect(chat.sendMessage(A, c.id, "Une question")).rejects.toMatchObject({ status: 502 });
    expect((await chat.getConversation(A, c.id)).messages.map((m) => m.role)).toEqual(["USER"]);
  });
});

describe("recherche web", () => {
  const web = {
    async search() {
      return {
        backend: "tavily" as const,
        results: [
          { title: "Cycle de vie d'une activité", url: "https://developer.android.com/guide/activity-lifecycle", host: "developer.android.com", snippet: "onCreate, onStart, onResume.", tier: "reconnue" as const },
          { title: "Mon blog", url: "https://blog.example.com/android", host: "blog.example.com", snippet: "Un avis personnel sur le cycle de vie des activités.", tier: "a_verifier" as const },
        ],
      };
    },
  };

  it("cite les sources web avec leur fiabilité, sans les confondre avec les passages de cours", async () => {
    __setWebSearcherForTests(web);
    seen.length = 0;
    script = (_req, step) => (step === 0 ? { calls: [{ name: "search_web", args: { query: "android activity lifecycle" }}] } : { text: "Trois méthodes clés [1]. Avis personnel [2]. Invention [5]." });
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    const r = await chat.sendMessage(A, c.id, "Cycle de vie Android ?");
    expect(r.message.citations.map((x) => [x.kind, x.tier])).toEqual([["web", "reconnue"], ["web", "a_verifier"]]);
    expect(r.message.citations[0].url).toContain("developer.android.com");
    expect(r.message.content).not.toContain("[5]");
    const consulted = r.message.consulted as { passages: number; webSources: number };
    expect([consulted.passages, consulted.webSources]).toEqual([0, 2]);
    expect(seen[0].tools?.map((t) => t.name)).toContain("search_web");
    expect(JSON.stringify(seen[1].turns.at(-1))).toContain("niveau 4");
    expect(seen[0].system).toContain("Je n'ai pas trouvé d'information fiable");
    expect(r.message.citations.map((x) => x.level)).toEqual([1, 4]);
    // Vérificateur en panne : rien n'est présenté comme vérifié.
    const v = (r.message.consulted as { verification: { status: string; limits: string[] } }).verification;
    expect(v.status).toBe("echec");
    expect(v.limits.join(" ")).toContain("n'a pas été contrôlée");
  });

  it("seules des sources à vérifier sont citées : réponse marquée non vérifiée", async () => {
    __setWebSearcherForTests(web);
    script = (_req, step) => (step === 0 ? { calls: [{ name: "search_web", args: { query: "android" } }] } : { text: "Les activités ont un cycle de vie discuté [2]. Trois méthodes clés existent [1]." });
    verifier = () => ({
      claims: [
        { text: "Les activités ont un cycle de vie discuté", preuves: [{ n: 2, position: "soutient", citation: "Un avis personnel sur le cycle de vie", directe: true }] },
        { text: "Trois méthodes clés existent", preuves: [{ n: 1, position: "soutient", citation: "onCreate, onStart, onResume", directe: true }] },
      ],
    });
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    const r = await chat.sendMessage(A, c.id, "Avis sur Android ?");
    verifier = () => {
      throw new Error("vérificateur indisponible");
    };
    const v = (r.message.consulted as { verification: { claims: { confidence: string }[] } }).verification;
    expect(v.claims.map((x) => x.confidence)).toEqual(["non_verifiee", "elevee"]);
    expect(r.message.content).toContain("⚠️");
    expect(r.message.content.indexOf("⚠️")).toBeLessThan(r.message.content.indexOf("Trois méthodes"));
    // Traçabilité : affirmations, sources, passages et dates sont conservés.
    const run = await db.verificationRun.findFirstOrThrow({ where: { entityId: r.message.id }, include: { claims: { include: { evidence: true } }, sources: true } });
    expect(run.claims).toHaveLength(2);
    expect(run.claims[1].evidence[0].quote).toBe("onCreate, onStart, onResume");
    expect(run.sources.find((s) => s.n === 1)).toMatchObject({ level: 1, sourceKind: "documentation", host: "developer.android.com" });
    expect(run.sources[0].retrievedAt).toBeInstanceOf(Date);
    // Supprimer la conversation supprime aussi ses vérifications.
    await chat.deleteConversation(A, c.id);
    expect(await db.verificationRun.count({ where: { entityId: r.message.id } })).toBe(0);
    __setWebSearcherForTests(undefined);
  });

  it("réponse immédiate : la vérification se termine après l'envoi et complète le message", async () => {
    __setWebSearcherForTests(web);
    script = (_req, step) => (step === 0 ? { calls: [{ name: "search_web", args: { query: "android" } }] } : { text: "Les activités ont un cycle de vie discuté [2]." });
    verifier = () => ({ claims: [{ text: "Les activités ont un cycle de vie discuté", preuves: [{ n: 2, position: "soutient", citation: "Un avis personnel sur le cycle de vie", directe: true }] }] });
    const tasks: (() => Promise<unknown>)[] = [];
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    const r = await chat.sendMessage(A, c.id, "Avis ?", { defer: (t) => void tasks.push(t) });
    expect((r.message.consulted as { verification: { status: string } }).verification.status).toBe("en_cours");
    expect(r.message.content).not.toContain("⚠️");
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    verifier = () => {
      throw new Error("vérificateur indisponible");
    };
    const saved = (await chat.getConversation(A, c.id)).messages.at(-1)!;
    expect((saved.consulted as { verification: { status: string } }).verification.status).toBe("effectuee");
    expect(saved.content).toContain("⚠️");
    expect(await db.verificationRun.count({ where: { entityId: saved.id } })).toBe(1);
    __setWebSearcherForTests(undefined);
  });

  it("réponse en flux : étape annoncée puis texte, avant le résultat final", async () => {
    __setWebSearcherForTests(web);
    script = (_req, step) => (step === 0 ? { calls: [{ name: "search_web", args: { query: "android" } }] } : { text: "Une réponse rédigée." });
    const events: ChatEvent[] = [];
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    const r = await chat.sendMessage(A, c.id, "Question", { emit: (e) => void events.push(e) });
    expect(events).toEqual([{ type: "status", text: "Recherche sur le web…" }, { type: "delta", text: "Une réponse rédigée." }]);
    expect(r.message.content).toContain("Une réponse rédigée.");
    __setWebSearcherForTests(undefined);
  });

  it("aucun résultat : le modèle reçoit la consigne de le dire clairement", async () => {
    __setWebSearcherForTests({ async search() { return { backend: "tavily" as const, results: [] }; } });
    seen.length = 0;
    script = (_req, step) => (step === 0 ? { calls: [{ name: "search_web", args: { query: "sujet introuvable" } }] } : { text: "❌ Je n'ai pas trouvé d'information fiable sur ce sujet." });
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    const r = await chat.sendMessage(A, c.id, "Sujet introuvable ?");
    const toolTurn = JSON.stringify(seen[1].turns.at(-1));
    expect(toolTurn).toContain("Je n'ai pas trouvé d'information fiable");
    expect((r.message.consulted as { verification: { webStatus: string } }).verification.webStatus).toBe("utilisee");
  });

  it("désactivée par l'étudiant : l'outil n'est pas proposé", async () => {
    seen.length = 0;
    script = () => ({ text: "Réponse sans web." });
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    await chat.sendMessage(A, c.id, "Question générale", { web: false });
    expect(seen[0].tools?.map((t) => t.name)).not.toContain("search_web");
    expect(seen[0].system).toContain("La recherche web est désactivée");
  });

  it("moteur indisponible : le modèle reçoit l'information et ne prétend rien avoir vérifié", async () => {
    __setWebSearcherForTests({ async search() { throw new WebSearchUnavailableError("quota"); } });
    seen.length = 0;
    script = (_req, step) => (step === 0 ? { calls: [{ name: "search_web", args: { query: "x" } }] } : { text: "Je n'ai pas pu vérifier sur le web." });
    const c = await chat.createConversation(A, { scope: "GLOBAL" });
    const r = await chat.sendMessage(A, c.id, "Vérifie sur le web");
    expect(JSON.stringify(seen[1].turns.at(-1))).toContain("momentanément indisponible");
    expect(r.message.citations).toEqual([]);
    expect((r.message.consulted as { verification: { webStatus: string } }).verification.webStatus).toBe("indisponible");
    __setWebSearcherForTests(undefined);
  });
});
