// Tests d'intégration du chat : vrai Prisma sur PGlite (migrations réelles), faux fournisseur déterministe.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider, ChatTurn, ConverseRequest } from "@/server/ai/provider";

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
    throw new Error("non utilisé");
  },
  async embed(texts) {
    return texts.map(vec);
  },
  async converse(req) {
    seen.push(req);
    const step = req.turns.filter((t: ChatTurn) => t.role === "model").length;
    const r = script(req, step);
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
  for (const name of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat"]) {
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
