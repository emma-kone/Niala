// Tests d'intégration des cartes : analyse réelle (PDF extrait) → cartes éditables, sauvegarde,
// provenance protégée côté serveur, concurrence, versions, isolation.
// Le fournisseur IA est un FAUX de test, uniquement ici.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { AiProvider } from "@/server/ai/provider";

type Db = typeof import("@/lib/db").db;
let db: Db;
let docs: typeof import("@/server/services/documents");
let analysis: typeof import("@/server/services/analysis/analysis-service");
let maps: typeof import("./maps");
let prov: typeof import("@/server/ai/provider");
let server: PGLiteSocketServer;
let pg: PGlite;
let dir: string;
let A: string, B: string, subj: string, analysisId: string, docId: string;

function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const kids: string[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((lines, i) => {
    const pg = 4 + i * 2;
    kids.push(`${pg} 0 R`);
    const body = lines.map((l, k) => `BT /F1 12 Tf 50 ${740 - k * 20} Td (${l}) Tj ET`).join("\n");
    objs[pg] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pg + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objs[pg + 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offs: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offs[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i] ?? "null"}\nendobj\n`;
  }
  const x = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const fake: AiProvider = {
  name: "fake-test",
  model: "fake-model",
  async complete(req) {
    const ids = [...req.user.matchAll(/\[\[SECTION (\d+)\]\]/g)].map((m) => Number(m[1]));
    return {
      model: "fake-model",
      text: JSON.stringify({
        sections: ids.map((id) => ({
          id,
          concepts:
            id === 2
              ? [
                  { name: "Fonction", kind: "DEFINITION", importance: 3, quote: "Une fonction est un bloc de code reutilisable que l'on appelle par son nom" },
                  { name: "Parametre", kind: "NOTION", importance: 2 },
                  { name: "Notion isolee", kind: "NOTION", importance: 1 },
                ]
              : [],
          relations: id === 2 ? [{ from: "Fonction", to: "Parametre", type: "PREREQUISITE" }] : [],
        })),
      }),
    };
  },
};

beforeAll(async () => {
  pg = await PGlite.create();
  for (const n of ["20261101000000_v1_baseline", "20261101000100_v2_foundation", "20261101000200_v2_backfill", "20261104000000_niala_theme_default", "20261104000100_niala_chat", "20261110000000_niala_agenda", "20261111000000_niala_academic", "20261112000000_niala_subject_icon", "20261113000000_niala_google_link", "20261116000000_niala_profile_exercises", "20261117000000_niala_class_level_other", "20261118000000_niala_admin"]) {
    await pg.exec(readFileSync(path.join(process.cwd(), "prisma", "migrations", n, "migration.sql"), "utf8"));
  }
  const port = 50000 + Math.floor(Math.random() * 10000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  dir = mkdtempSync(path.join(tmpdir(), "sf-maps-"));
  process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?connection_limit=1&pgbouncer=true`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.STORAGE_DIR = dir;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.GEMINI_API_KEY = ""; // vide (et non supprimé) : Prisma recharge .env sinon
  db = (await import("@/lib/db")).db;
  docs = await import("@/server/services/documents");
  analysis = await import("@/server/services/analysis/analysis-service");
  maps = await import("./maps");
  prov = await import("@/server/ai/provider");
  A = (await db.user.create({ data: { email: "a@x.fr", passwordHash: "x" } })).id;
  B = (await db.user.create({ data: { email: "b@x.fr", passwordHash: "x" } })).id;
  subj = (await db.subject.create({ data: { userId: A, name: "Algo" } })).id;

  const data = makePdf([
    ["CHAPITRE II : LES FONCTIONS", "I. Introduction aux fonctions", "Une fonction est un bloc de code reutilisable que l'on appelle par son nom.", "II. Declaration des fonctions", "A. Declaration classique", "B. Expression de fonction"],
  ]);
  const [r] = await docs.prepareUploads(A, { subjectId: subj, folderId: null, files: [{ name: "cours.pdf", size: data.length }] });
  if (!r.ok) throw new Error("prepare");
  await docs.receiveLocalUpload(A, r.versionId, data);
  await docs.finalizeUpload(A, r.versionId);
  docId = r.documentId;
  prov.__setProviderForTests(fake);
  analysisId = (await analysis.runAnalysis(A, docId)).analysisId;
}, 90_000);

afterAll(async () => {
  prov?.__setProviderForTests(undefined);
  await db?.$disconnect();
  await server?.stop();
  await pg?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("génération", () => {
  let structureId: string, conceptId: string;

  it("carte de structure : le plan réel, relations enfant → parent, provenance conservée", async () => {
    structureId = (await maps.generateStructureMap(A, analysisId)).id;
    const m = await maps.getMap(A, structureId);
    expect(m).toMatchObject({ kind: "STRUCTURE", revision: 1, title: "Plan — cours" });
    const labels = m.nodes.map((n) => n.label);
    expect(labels).toEqual(expect.arrayContaining(["cours", "II. LES FONCTIONS", "I. Introduction aux fonctions", "A. Declaration classique"]));
    expect(m.nodes).toHaveLength(6);
    expect(m.edges).toHaveLength(5);
    expect(m.edges.every((e) => e.type === "PART_OF")).toBe(true);
    const byLabel = Object.fromEntries(m.nodes.map((n) => [n.label, n]));
    const edgeOf = (child: string) => m.edges.find((e) => e.source === byLabel[child].id)!;
    expect(edgeOf("II. LES FONCTIONS").target).toBe(byLabel["cours"].id);
    expect(edgeOf("A. Declaration classique").target).toBe(byLabel["II. Declaration des fonctions"].id);
    expect(m.nodes.every((n) => n.origin === "DOCUMENT")).toBe(true);
    expect(byLabel["II. LES FONCTIONS"].sectionId).toBeTruthy();
    expect(byLabel["I. Introduction aux fonctions"].x).toBeGreaterThan(byLabel["II. LES FONCTIONS"].x);
    expect(m.document?.name).toBe("cours");
  });

  it("carte conceptuelle : notions, relations, origines et notions isolées", async () => {
    conceptId = (await maps.generateConceptMap(A, analysisId)).id;
    const m = await maps.getMap(A, conceptId);
    const byLabel = Object.fromEntries(m.nodes.map((n) => [n.label, n]));
    expect(Object.keys(byLabel).sort()).toEqual(["Fonction", "Notion isolee", "Parametre"]);
    expect(byLabel["Fonction"].origin).toBe("DOCUMENT");
    expect(byLabel["Parametre"].origin).toBe("AI_INFERRED");
    expect(byLabel["Fonction"].conceptId).toBeTruthy();
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0]).toMatchObject({ type: "PREREQUISITE", origin: "AI_INFERRED", source: byLabel["Fonction"].id, target: byLabel["Parametre"].id });
    expect(byLabel["Fonction"].x).toBeLessThan(byLabel["Parametre"].x); // le prérequis est à gauche
    expect(byLabel["Notion isolee"].y).toBeGreaterThan(byLabel["Fonction"].y);
  });

  it("refuse de générer depuis l'analyse d'un autre utilisateur ou sans contenu", async () => {
    await expect(maps.generateStructureMap(B, analysisId)).rejects.toMatchObject({ status: 404 });
    await expect(maps.generateConceptMap(B, analysisId)).rejects.toMatchObject({ status: 404 });
  });

  it("liste les cartes de la matière", async () => {
    const list = await maps.listMaps(A, subj);
    expect(list.map((m) => m.kind).sort()).toEqual(["CONCEPT", "STRUCTURE"]);
    expect(list[0].document?.name).toBe("cours");
    await expect(maps.listMaps(B, subj)).rejects.toMatchObject({ status: 404 });
  });
});

describe("édition et sauvegarde", () => {
  let id: string;
  let state: Awaited<ReturnType<typeof maps.getMap>>;
  const toInput = (m: typeof state) => ({
    title: m.title,
    nodes: m.nodes.map((n) => ({ id: n.id, label: n.label, x: n.x, y: n.y, origin: n.origin, data: n.data })),
    edges: m.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, type: e.type, label: e.label, origin: e.origin })),
  });

  beforeAll(async () => {
    id = (await maps.generateConceptMap(A, analysisId)).id;
    state = await maps.getMap(A, id);
  });

  it("ajoute, déplace, renomme et relie — la provenance reste décidée par le serveur", async () => {
    const input = toInput(state);
    const fn = input.nodes.find((n) => n.label === "Fonction")!;
    fn.label = "Fonction (reformulée)";
    fn.x = 999;
    // le client triche : se déclare « DOCUMENT » pour un nœud qu'il ajoute et change l'origine d'un existant
    input.nodes.push({ id: "node-manuel-1", label: "Idée perso", x: 10, y: 20, origin: "DOCUMENT", data: { note: "à revoir" } });
    input.nodes.find((n) => n.label === "Parametre")!.origin = "DOCUMENT";
    input.edges.push({ id: "edge-manuel-1", source: "node-manuel-1", target: fn.id, type: "EXAMPLE_OF", label: "illustre", origin: "DOCUMENT" });
    const saved = await maps.saveMap(A, id, { revision: state.revision, ...input });
    expect(saved.revision).toBe(state.revision + 1);
    const m = await maps.getMap(A, id);
    const byLabel = Object.fromEntries(m.nodes.map((n) => [n.label, n]));
    expect(byLabel["Fonction (reformulée)"]).toMatchObject({ x: 999, origin: "DOCUMENT" });
    expect(byLabel["Fonction (reformulée)"].data?.edited).toBe(true); // corrigé par l'étudiant, tracé
    expect(byLabel["Idée perso"]).toMatchObject({ origin: "USER", conceptId: null });
    expect(byLabel["Parametre"].origin).toBe("AI_INFERRED"); // non modifiable depuis le client
    expect(m.edges.find((e) => e.id === "edge-manuel-1")).toMatchObject({ origin: "USER", type: "EXAMPLE_OF", label: "illustre" });
    state = m;
  });

  it("changer le type d'une relation la fait passer « à la charge de l'étudiant »", async () => {
    const input = toInput(state);
    const e = input.edges.find((x) => x.type === "PREREQUISITE")!;
    e.type = "CONTRASTS";
    await maps.saveMap(A, id, { revision: state.revision, ...input });
    state = await maps.getMap(A, id);
    expect(state.edges.find((x) => x.id === e.id)).toMatchObject({ type: "CONTRASTS", origin: "USER" });
  });

  it("supprime un nœud avec ses relations", async () => {
    const input = toInput(state);
    const gone = input.nodes.find((n) => n.label === "Idée perso")!;
    input.nodes = input.nodes.filter((n) => n.id !== gone.id);
    input.edges = input.edges.filter((e) => e.source !== gone.id && e.target !== gone.id);
    await maps.saveMap(A, id, { revision: state.revision, ...input });
    state = await maps.getMap(A, id);
    expect(state.nodes.some((n) => n.id === gone.id)).toBe(false);
    expect(state.edges.some((e) => e.id === "edge-manuel-1")).toBe(false);
  });

  it("refuse une sauvegarde sur une révision périmée (jamais d'écrasement silencieux)", async () => {
    await expect(maps.saveMap(A, id, { revision: 1, ...toInput(state) })).rejects.toMatchObject({ status: 409, extra: { currentRevision: state.revision } });
  });

  it("rejette un état invalide sans rien modifier", async () => {
    const input = toInput(state);
    input.edges.push({ id: "edge-bad-0001", source: input.nodes[0].id, target: "node-inexistant", type: "RELATED", label: null, origin: "USER" });
    await expect(maps.saveMap(A, id, { revision: state.revision, ...input })).rejects.toMatchObject({ status: 422 });
    expect((await maps.getMap(A, id)).revision).toBe(state.revision);
  });

  it("refuse un identifiant déjà utilisé par une autre carte", async () => {
    const other = (await maps.createEmptyMap(A, subj, "Autre", "CONCEPT")).id;
    const o = await maps.getMap(A, other);
    const input = { title: "Autre", nodes: [{ id: state.nodes[0].id, label: "Vol d'identifiant", x: 0, y: 0, origin: "USER" as const }], edges: [] };
    await expect(maps.saveMap(A, other, { revision: o.revision, ...input })).rejects.toMatchObject({ status: 409 });
  });

  it("isole les utilisateurs", async () => {
    await expect(maps.getMap(B, id)).rejects.toMatchObject({ status: 404 });
    await expect(maps.saveMap(B, id, { revision: state.revision, ...toInput(state) })).rejects.toMatchObject({ status: 404 });
    await expect(maps.renameMap(B, id, "x")).rejects.toMatchObject({ status: 404 });
    await expect(maps.deleteMap(B, id)).rejects.toMatchObject({ status: 404 });
    await expect(maps.createRestorePoint(B, id)).rejects.toMatchObject({ status: 404 });
    await expect(maps.restoreRevision(B, id, 1)).rejects.toMatchObject({ status: 404 });
    await expect(maps.createEmptyMap(B, subj, "x", "CONCEPT")).rejects.toMatchObject({ status: 404 });
  });

  it("points de restauration : revenir en arrière conserve l'état actuel comme version", async () => {
    const before = await maps.getMap(A, id);
    await maps.createRestorePoint(A, id);
    const input = toInput(before);
    input.nodes = input.nodes.slice(0, 1);
    input.edges = [];
    await maps.saveMap(A, id, { revision: before.revision, ...input });
    expect((await maps.getMap(A, id)).nodes).toHaveLength(1);
    const revs = (await maps.getMap(A, id)).revisions;
    const restorePoint = revs.map((r) => r.number).sort((a, b) => a - b).find((n) => n >= 1)!;
    const target = await db.mindMapRevision.findMany({ where: { mapId: id }, orderBy: { number: "asc" } });
    const withAllNodes = target.find((t) => (t.snapshot as { nodes: unknown[] }).nodes.length === before.nodes.length)!;
    expect(restorePoint).toBeGreaterThan(0);
    const restored = await maps.restoreRevision(A, id, withAllNodes.number);
    expect(restored.nodes).toHaveLength(before.nodes.length);
    expect(restored.edges).toHaveLength(before.edges.length);
    // l'état « 1 nœud » est lui-même récupérable
    const after = await db.mindMapRevision.findMany({ where: { mapId: id } });
    expect(after.some((r) => (r.snapshot as { nodes: unknown[] }).nodes.length === 1)).toBe(true);
  });

  it("supprime une carte et ses éléments", async () => {
    await maps.deleteMap(A, id);
    expect(await db.mindMapNode.count({ where: { mapId: id } })).toBe(0);
    expect(await db.mindMapRevision.count({ where: { mapId: id } })).toBe(0);
  });
});
