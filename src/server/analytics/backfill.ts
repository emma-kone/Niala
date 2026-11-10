import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { actorKeyOf } from "@/server/analytics/track";
import type { EventType } from "@/server/analytics/definitions";
import { ensureActorKeys } from "@/server/admin/stats/common";

// ─────────────────────────────────────────────────────────────────────────────
// Reconstitution de l'historique d'événements à partir des tables d'origine (inscriptions, exercices, tentatives,
// imports, cartes, labos). Chaque événement reconstitué porte source = BACKFILL et l'identifiant de sa ligne d'origine :
// l'opération est rejouable sans doublon, et jamais confondue avec la collecte en direct.
// Ne sont PAS reconstitués (aucune trace datée dans la base) : connexions, déconnexions, ouvertures de module, consultation de cours.
// ─────────────────────────────────────────────────────────────────────────────

const BATCH = 1000;

type Row = { userId: string; id: string; at: Date; ok?: boolean; module?: string; props?: Record<string, string | number | boolean | null>; durationMs?: number };

export interface BackfillResult { type: EventType; scanned: number; inserted: number }

async function insert(type: EventType, rows: Row[], categories: Map<string, string | null>): Promise<number> {
  if (!rows.length) return 0;
  const data: Prisma.AnalyticsEventCreateManyInput[] = rows.map((r) => ({
    type,
    module: r.module ?? null,
    actorKey: actorKeyOf(r.userId),
    category: categories.get(r.userId) ?? null,
    source: "BACKFILL",
    sourceRef: r.id,
    ok: r.ok ?? true,
    durationMs: r.durationMs ?? null,
    props: (r.props ?? undefined) as Prisma.InputJsonValue | undefined,
    createdAt: r.at,
  }));
  return (await db.analyticsEvent.createMany({ data, skipDuplicates: true })).count;
}

/** Parcourt une table par pages et insère les événements correspondants. */
async function run<T extends { id: string }>(type: EventType, fetchPage: (cursor: string | undefined) => Promise<T[]>, toRow: (t: T) => Row | null): Promise<BackfillResult> {
  let cursor: string | undefined;
  let scanned = 0;
  let inserted = 0;
  for (;;) {
    const page = await fetchPage(cursor);
    if (!page.length) break;
    scanned += page.length;
    const rows = page.map(toRow).filter((r): r is Row => !!r);
    const users = [...new Set(rows.map((r) => r.userId))];
    const profiles = await db.studentProfile.findMany({ where: { userId: { in: users } }, select: { userId: true, category: true } });
    inserted += await insert(type, rows, new Map(profiles.map((p) => [p.userId, p.category])));
    cursor = page.at(-1)!.id;
    if (page.length < BATCH) break;
  }
  return { type, scanned, inserted };
}

export async function backfillAnalytics(): Promise<BackfillResult[]> {
  await ensureActorKeys();
  const page = { take: BATCH, orderBy: { id: "asc" as const } };
  const after = (c: string | undefined): { cursor?: { id: string }; skip?: number } => (c ? { cursor: { id: c }, skip: 1 } : {});
  const out: BackfillResult[] = [];

  out.push(await run("account.register", (c) => db.user.findMany({ where: { adminRole: null }, select: { id: true, createdAt: true }, ...page, ...after(c) }), (u) => ({ userId: u.id, id: u.id, at: u.createdAt })));
  out.push(await run("exercise.generate", (c) => db.exercise.findMany({ where: { origin: { not: "IMPORTED" } }, select: { id: true, userId: true, createdAt: true, origin: true }, ...page, ...after(c) }), (e) => ({ userId: e.userId, id: e.id, at: e.createdAt, module: "exercises", props: { origin: e.origin } })));
  out.push(await run("exercise.import", (c) => db.exercise.findMany({ where: { origin: "IMPORTED" }, select: { id: true, userId: true, createdAt: true }, ...page, ...after(c) }), (e) => ({ userId: e.userId, id: e.id, at: e.createdAt, module: "exercises", props: { origin: "IMPORTED" } })));
  out.push(await run("exercise.start", (c) => db.exerciseAttempt.findMany({ select: { id: true, userId: true, startedAt: true }, ...page, ...after(c) }), (a) => ({ userId: a.userId, id: a.id, at: a.startedAt, module: "exercises" })));
  out.push(await run("exercise.complete", (c) => db.exerciseAttempt.findMany({ where: { status: { in: ["GRADED", "SUBMITTED"] }, finishedAt: { not: null } }, select: { id: true, userId: true, finishedAt: true, durationSec: true, score: true, maxScore: true }, ...page, ...after(c) }), (a) => ({ userId: a.userId, id: a.id, at: a.finishedAt!, module: "exercises", durationMs: a.durationSec ? a.durationSec * 1000 : undefined, props: { score: a.score ?? null, max: a.maxScore ?? null } })));
  out.push(await run("document.import", (c) => db.documentVersion.findMany({ select: { id: true, userId: true, createdAt: true, extractStatus: true }, ...page, ...after(c) }), (v) => ({ userId: v.userId, id: v.id, at: v.createdAt, module: "documents", ok: v.extractStatus !== "FAILED" })));
  out.push(await run("map.create", (c) => db.mindMap.findMany({ select: { id: true, userId: true, createdAt: true, kind: true }, ...page, ...after(c) }), (m) => ({ userId: m.userId, id: m.id, at: m.createdAt, module: "maps", props: { kind: m.kind } })));
  out.push(await run("lab.create", (c) => db.labWorkspace.findMany({ where: { mode: "FREE" }, select: { id: true, userId: true, createdAt: true, kind: true }, ...page, ...after(c) }), (w) => ({ userId: w.userId, id: w.id, at: w.createdAt, module: w.kind === "SQL" ? "sql" : "code", props: { kind: w.kind, mode: "FREE" } })));
  out.push(await run("lab.run", (c) => db.labRun.findMany({ select: { id: true, userId: true, createdAt: true, workspace: { select: { kind: true } } }, ...page, ...after(c) }), (r) => ({ userId: r.userId, id: r.id, at: r.createdAt, module: r.workspace.kind === "SQL" ? "sql" : "code", props: { kind: r.workspace.kind } })));

  // Assistant : aucun identifiant stable n'est partagé avec la collecte en direct, donc on ne reconstitue que ce qui précède celle-ci.
  const firstLive = await db.analyticsEvent.findFirst({ where: { type: "assistant.message", source: "LIVE" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  out.push(
    await run(
      "assistant.message",
      (c) => db.aIUsageLog.findMany({ where: { op: { startsWith: "chat.turn" }, userId: { not: null }, ...(firstLive ? { createdAt: { lt: firstLive.createdAt } } : {}) }, select: { id: true, userId: true, createdAt: true, ok: true, durationMs: true }, ...page, ...after(c) }),
      (l) => ({ userId: l.userId!, id: l.id, at: l.createdAt, module: "assistant", ok: l.ok, durationMs: l.durationMs ?? undefined }),
    ),
  );
  return out;
}
