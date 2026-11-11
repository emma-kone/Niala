import { randomBytes } from "node:crypto";
import { Prisma, type MapKind, type Origin, type RelationType } from "@prisma/client";
import { db, type DbTx } from "@/lib/db";
import { softDelete } from "@/lib/soft-delete";
import { ApiHttpError } from "@/lib/api-helpers";
import { requireSubject } from "@/server/services/folders";
import { layoutLayers, layoutTree } from "@/server/domain/map-layout";
import { MAX_NODES, mapStateSchema, type MapEdgeInput, type MapNodeInput, type MapState } from "@/server/domain/map-validation";
import { track } from "@/server/analytics/track";

// ─────────────────────────────────────────────────────────────────────────────
// Cartes = graphes ÉDITABLES (nœuds + relations), jamais une image. La provenance est gardée par le
// serveur : le client ne peut pas faire passer un nœud qu'il ajoute pour « présent dans le document ».
//   • structure : plan hiérarchique de l'analyse (relations « fait partie de », enfant → parent) ;
//   • conceptuelle : notions et relations entre notions.
// ─────────────────────────────────────────────────────────────────────────────

const SNAPSHOT_EVERY_MS = 5 * 60_000;
const MAX_REVISIONS = 30;

const newId = (prefix: string) => prefix + randomBytes(10).toString("hex");

type NodeDto = { id: string; label: string; x: number; y: number; origin: Origin; conceptId: string | null; sectionId: string | null; data: MapNodeInput["data"] };
type EdgeDto = { id: string; source: string; target: string; type: RelationType; label: string | null; origin: Origin };
interface Snapshot {
  title: string;
  nodes: NodeDto[];
  edges: EdgeDto[];
}

async function ownedMap(userId: string, id: string) {
  const map = await db.mindMap.findFirst({ where: { id, userId } });
  if (!map) throw new ApiHttpError("Carte introuvable.", 404);
  return map;
}

async function readState(tx: DbTx | typeof db, mapId: string): Promise<{ nodes: NodeDto[]; edges: EdgeDto[] }> {
  const [nodes, edges] = await Promise.all([tx.mindMapNode.findMany({ where: { mapId } }), tx.mindMapEdge.findMany({ where: { mapId } })]);
  return {
    nodes: nodes.map((n) => ({ id: n.id, label: n.label, x: n.x, y: n.y, origin: n.origin, conceptId: n.conceptId, sectionId: n.sectionId, data: (n.data as NodeDto["data"]) ?? null })),
    edges: edges.map((e) => ({ id: e.id, source: e.sourceId, target: e.targetId, type: e.type, label: e.label, origin: e.origin })),
  };
}

async function snapshot(tx: DbTx, userId: string, map: { id: string; title: string }) {
  const state = await readState(tx, map.id);
  const last = await tx.mindMapRevision.findFirst({ where: { mapId: map.id }, orderBy: { number: "desc" } });
  const content: Snapshot = { title: map.title, ...state };
  await tx.mindMapRevision.create({
    data: { userId, mapId: map.id, number: (last?.number ?? 0) + 1, snapshot: content as unknown as Prisma.InputJsonValue },
  });
  const old = await tx.mindMapRevision.findMany({ where: { mapId: map.id }, orderBy: { number: "desc" }, skip: MAX_REVISIONS, select: { id: true } });
  if (old.length) await tx.mindMapRevision.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

// ── Lecture ──────────────────────────────────────────────────────────────────

export async function listMaps(userId: string, subjectId: string) {
  await requireSubject(userId, subjectId);
  const maps = await db.mindMap.findMany({
    where: { userId, subjectId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { nodes: true, edges: true } }, analysis: { select: { version: { select: { document: { select: { id: true, name: true } } } } } } },
  });
  return maps.map((m) => ({
    id: m.id,
    title: m.title,
    kind: m.kind,
    updatedAt: m.updatedAt,
    nodes: m._count.nodes,
    edges: m._count.edges,
    document: m.analysis?.version.document ?? null,
  }));
}

export async function getMap(userId: string, id: string) {
  const map = await ownedMap(userId, id);
  const [state, revisions, doc] = await Promise.all([
    readState(db, id),
    db.mindMapRevision.findMany({ where: { mapId: id }, orderBy: { number: "desc" }, select: { number: true, createdAt: true } }),
    map.analysisId
      ? db.documentAnalysis.findFirst({ where: { id: map.analysisId }, select: { version: { select: { document: { select: { id: true, name: true } } } } } })
      : null,
  ]);
  return {
    id: map.id,
    subjectId: map.subjectId,
    title: map.title,
    kind: map.kind,
    revision: map.revision,
    updatedAt: map.updatedAt,
    document: doc?.version.document ?? null,
    ...state,
    revisions,
  };
}

// ── Création / génération ────────────────────────────────────────────────────

export async function createEmptyMap(userId: string, subjectId: string, title: string, kind: MapKind) {
  await requireSubject(userId, subjectId);
  const map = await db.mindMap.create({ data: { userId, subjectId, title: title.trim().slice(0, 160) || "Nouvelle carte", kind } });
  track(userId, "map.create", { module: "maps", sourceRef: map.id, props: { kind, generated: false } });
  return { id: map.id };
}

async function analysisContext(userId: string, analysisId: string) {
  const a = await db.documentAnalysis.findFirst({
    where: { id: analysisId, userId },
    include: { version: { select: { document: { select: { id: true, name: true, subjectId: true } } } } },
  });
  const doc = a?.version.document;
  if (!a || !doc?.subjectId) throw new ApiHttpError("Analyse introuvable.", 404);
  return { analysis: a, doc, subjectId: doc.subjectId };
}

/** MindMapGenerationService : carte de STRUCTURE — le plan réel du document, avec la provenance de chaque titre. */
export async function generateStructureMap(userId: string, analysisId: string) {
  const { doc, subjectId } = await analysisContext(userId, analysisId);
  const sections = await db.courseSection.findMany({ where: { analysisId, userId }, orderBy: [{ level: "asc" }, { position: "asc" }] });
  if (sections.length === 0) throw new ApiHttpError("Cette analyse ne contient aucun plan à cartographier.", 409);
  if (sections.length >= MAX_NODES) throw new ApiHttpError("Le plan est trop volumineux pour une carte.", 409);

  const rootId = newId("n");
  const ids = new Map(sections.map((s) => [s.id, newId("n")]));
  const children = new Map<string | null, typeof sections>();
  for (const s of sections) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s].sort((a, b) => a.position - b.position));
  const ordered: typeof sections = [];
  const walk = (p: string | null) => {
    for (const s of children.get(p) ?? []) {
      ordered.push(s);
      walk(s.id);
    }
  };
  walk(null);

  const nodes: NodeDto[] = [
    { id: rootId, label: doc.name.slice(0, 200), x: 0, y: 0, origin: "DOCUMENT", conceptId: null, sectionId: null, data: null },
    ...ordered.map((s) => ({
      id: ids.get(s.id)!,
      label: `${s.numbering ? s.numbering + ". " : ""}${s.label}`.slice(0, 200),
      x: 0,
      y: 0,
      origin: s.origin,
      conceptId: null,
      sectionId: s.id,
      data: s.pageStart ? { page: s.pageStart } : null,
    })),
  ];
  const edges: EdgeDto[] = ordered.map((s) => ({
    id: newId("e"),
    source: ids.get(s.id)!,
    target: s.parentId ? ids.get(s.parentId)! : rootId,
    type: "PART_OF",
    label: null,
    origin: s.origin,
  }));
  const pos = layoutTree(nodes, edges);
  for (const n of nodes) Object.assign(n, pos[n.id]);
  return persistGenerated(userId, subjectId, analysisId, "STRUCTURE", `Plan — ${doc.name}`.slice(0, 160), nodes, edges);
}

/** Carte CONCEPTUELLE : les notions de l'analyse et les relations entre elles. */
export async function generateConceptMap(userId: string, analysisId: string) {
  const { doc, subjectId } = await analysisContext(userId, analysisId);
  const sources = await db.conceptSource.findMany({ where: { analysisId, userId }, include: { concept: true }, orderBy: { id: "asc" } });
  if (sources.length === 0) throw new ApiHttpError("Cette analyse ne contient aucune notion. Les notions sont extraites par le service d'IA.", 409);

  const byConcept = new Map<string, typeof sources>();
  for (const s of sources) byConcept.set(s.conceptId, [...(byConcept.get(s.conceptId) ?? []), s]);
  const concepts = [...byConcept.entries()]
    .sort((a, b) => b[1][0].concept.importance - a[1][0].concept.importance)
    .slice(0, MAX_NODES);
  const nodeOf = new Map<string, string>();
  const nodes: NodeDto[] = concepts.map(([conceptId, srcs]) => {
    const id = newId("n");
    nodeOf.set(conceptId, id);
    const origin: Origin = srcs.some((s) => s.origin === "DOCUMENT") ? "DOCUMENT" : srcs.every((s) => s.origin === "USER") ? "USER" : "AI_INFERRED";
    const refPage = srcs.flatMap((s) => (s.refs as { page: number | null }[] | null) ?? []).find((r) => r.page)?.page ?? null;
    const definition = srcs.find((s) => s.definition)?.definition ?? undefined;
    return {
      id,
      label: srcs[0].concept.name.slice(0, 200),
      x: 0,
      y: 0,
      origin,
      conceptId,
      sectionId: srcs[0].sectionId,
      data: refPage || definition ? { ...(refPage ? { page: refPage } : {}), ...(definition ? { definition: definition.slice(0, 600) } : {}) } : null,
    };
  });
  const relations = await db.conceptRelation.findMany({ where: { userId, fromId: { in: [...nodeOf.keys()] }, toId: { in: [...nodeOf.keys()] } } });
  const edges: EdgeDto[] = relations.map((r) => ({ id: newId("e"), source: nodeOf.get(r.fromId)!, target: nodeOf.get(r.toId)!, type: r.type, label: null, origin: r.origin }));
  const pos = layoutLayers(nodes, edges);
  for (const n of nodes) Object.assign(n, pos[n.id]);
  return persistGenerated(userId, subjectId, analysisId, "CONCEPT", `Notions — ${doc.name}`.slice(0, 160), nodes, edges);
}

async function persistGenerated(userId: string, subjectId: string, analysisId: string, kind: MapKind, title: string, nodes: NodeDto[], edges: EdgeDto[]) {
  const map = await db.$transaction(async (tx) => {
    const m = await tx.mindMap.create({ data: { userId, subjectId, analysisId, kind, title } });
    await tx.mindMapNode.createMany({
      data: nodes.map((n) => ({ id: n.id, userId, mapId: m.id, label: n.label, x: n.x, y: n.y, origin: n.origin, conceptId: n.conceptId, sectionId: n.sectionId, data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined })),
    });
    await tx.mindMapEdge.createMany({
      data: edges.map((e) => ({ id: e.id, userId, mapId: m.id, sourceId: e.source, targetId: e.target, type: e.type, label: e.label, origin: e.origin })),
    });
    return m;
  }, { timeout: 30_000 });
  track(userId, "map.create", { module: "maps", sourceRef: map.id, props: { kind, generated: true } });
  return { id: map.id };
}

// ── Sauvegarde (état complet, concurrence optimiste) ─────────────────────────


export async function saveMap(userId: string, id: string, input: { revision: number } & Record<string, unknown>) {
  const parsed = mapStateSchema.safeParse({ title: input.title, nodes: input.nodes, edges: input.edges });
  if (!parsed.success) throw new ApiHttpError(parsed.error.issues[0]?.message ?? "Carte invalide.", 422);
  const state: MapState = parsed.data;

  return db.$transaction(async (tx) => {
    const map = await tx.mindMap.findFirst({ where: { id, userId } });
    if (!map) throw new ApiHttpError("Carte introuvable.", 404);
    if (map.revision !== input.revision) {
      throw new ApiHttpError("Cette carte a été modifiée ailleurs. Rechargez-la pour éviter d'écraser ces changements.", 409, { currentRevision: map.revision });
    }
    const current = await readState(tx, id);
    const nodeById = new Map(current.nodes.map((n) => [n.id, n]));
    const edgeById = new Map(current.edges.map((e) => [e.id, e]));

    // Les identifiants nouveaux ne doivent appartenir à aucune autre carte
    const newNodeIds = state.nodes.filter((n) => !nodeById.has(n.id)).map((n) => n.id);
    const newEdgeIds = state.edges.filter((e) => !edgeById.has(e.id)).map((e) => e.id);
    if (newNodeIds.length && (await tx.mindMapNode.count({ where: { id: { in: newNodeIds } } })) > 0) throw new ApiHttpError("Identifiant de nœud déjà utilisé.", 409);
    if (newEdgeIds.length && (await tx.mindMapEdge.count({ where: { id: { in: newEdgeIds } } })) > 0) throw new ApiHttpError("Identifiant de relation déjà utilisé.", 409);

    // Point de restauration automatique si le dernier date de plus de 5 minutes
    const lastRev = await tx.mindMapRevision.findFirst({ where: { mapId: id }, orderBy: { number: "desc" } });
    if (!lastRev || Date.now() - lastRev.createdAt.getTime() > SNAPSHOT_EVERY_MS) await snapshot(tx, userId, map);

    const keepNodes = new Set(state.nodes.map((n) => n.id));
    const keepEdges = new Set(state.edges.map((e) => e.id));
    await tx.mindMapEdge.deleteMany({ where: { mapId: id, id: { notIn: [...keepEdges] } } });
    await tx.mindMapNode.deleteMany({ where: { mapId: id, id: { notIn: [...keepNodes] } } });

    for (const n of state.nodes) {
      const prev = nodeById.get(n.id);
      if (prev) {
        const edited = prev.label !== n.label || prev.data?.edited === true;
        const data = { ...(n.data ?? {}), ...(prev.data?.page ? { page: prev.data.page } : {}), ...(edited ? { edited: true } : {}) };
        await tx.mindMapNode.update({
          where: { id: n.id },
          data: { label: n.label, x: n.x, y: n.y, data: Object.keys(data).length ? (data as Prisma.InputJsonValue) : Prisma.JsonNull },
          // origine, notion et section ne changent jamais depuis le client
        });
      } else {
        await tx.mindMapNode.create({
          data: { id: n.id, userId, mapId: id, label: n.label, x: n.x, y: n.y, origin: "USER", data: n.data ? ({ note: n.data.note } as Prisma.InputJsonValue) : undefined },
        });
      }
    }
    for (const e of state.edges) {
      const prev = edgeById.get(e.id);
      if (prev) {
        const changed = prev.type !== e.type || (prev.label ?? null) !== (e.label ?? null);
        await tx.mindMapEdge.update({ where: { id: e.id }, data: { type: e.type, label: e.label ?? null, ...(changed ? { origin: "USER" } : {}) } });
      } else {
        await tx.mindMapEdge.create({ data: { id: e.id, userId, mapId: id, sourceId: e.source, targetId: e.target, type: e.type, label: e.label ?? null, origin: "USER" } });
      }
    }
    const updated = await tx.mindMap.update({ where: { id }, data: { revision: { increment: 1 }, ...(state.title ? { title: state.title } : {}) } });
    return { revision: updated.revision, state: await readState(tx, id) };
  }, { timeout: 30_000 });
}

export async function renameMap(userId: string, id: string, title: string) {
  const res = await db.mindMap.updateMany({ where: { id, userId }, data: { title: title.trim().slice(0, 160) } });
  if (res.count === 0) throw new ApiHttpError("Carte introuvable.", 404);
  return { ok: true };
}

export async function deleteMap(userId: string, id: string) {
  const removed = await softDelete(db, "MindMap", { id, userId });
  if (!removed.length) throw new ApiHttpError("Carte introuvable.", 404);
  return { ok: true };
}

// ── Versions ─────────────────────────────────────────────────────────────────

export async function createRestorePoint(userId: string, id: string) {
  const map = await ownedMap(userId, id);
  await db.$transaction((tx) => snapshot(tx, userId, map));
  return { ok: true };
}

export async function restoreRevision(userId: string, id: string, number: number) {
  const map = await ownedMap(userId, id);
  const rev = await db.mindMapRevision.findFirst({ where: { mapId: id, userId, number } });
  if (!rev) throw new ApiHttpError("Version introuvable.", 404);
  const snap = rev.snapshot as unknown as Snapshot;
  await db.$transaction(async (tx) => {
    await snapshot(tx, userId, map); // l'état actuel reste récupérable
    await tx.mindMapEdge.deleteMany({ where: { mapId: id } });
    await tx.mindMapNode.deleteMany({ where: { mapId: id } });
    // les liens vers notions/sections supprimées entre-temps sont abandonnés
    const concepts = new Set((await tx.concept.findMany({ where: { userId, id: { in: snap.nodes.map((n) => n.conceptId).filter((x): x is string => !!x) } }, select: { id: true } })).map((c) => c.id));
    const sections = new Set((await tx.courseSection.findMany({ where: { userId, id: { in: snap.nodes.map((n) => n.sectionId).filter((x): x is string => !!x) } }, select: { id: true } })).map((c) => c.id));
    await tx.mindMapNode.createMany({
      data: snap.nodes.map((n) => ({
        id: n.id, userId, mapId: id, label: n.label, x: n.x, y: n.y, origin: n.origin,
        conceptId: n.conceptId && concepts.has(n.conceptId) ? n.conceptId : null,
        sectionId: n.sectionId && sections.has(n.sectionId) ? n.sectionId : null,
        data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
    await tx.mindMapEdge.createMany({ data: snap.edges.map((e) => ({ id: e.id, userId, mapId: id, sourceId: e.source, targetId: e.target, type: e.type, label: e.label, origin: e.origin })) });
    await tx.mindMap.update({ where: { id }, data: { title: snap.title, revision: { increment: 1 } } });
  }, { timeout: 30_000 });
  return getMap(userId, id);
}

