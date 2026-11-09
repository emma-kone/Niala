import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";

// Versions d'une production pratique : un point automatique au plus toutes les 2 minutes, des points explicites à la demande.
// L'étudiant peut revenir à une version antérieure ; les 25 dernières sont conservées.

const EVERY_MS = 2 * 60_000;
const KEEP = 25;

export async function recordRevision(userId: string, attemptId: string, position: number, data: unknown, opts: { force?: boolean } = {}) {
  const last = await db.workspaceRevision.findFirst({ where: { attemptId, position, userId }, orderBy: { number: "desc" }, select: { number: true, createdAt: true } });
  if (!opts.force && last && Date.now() - last.createdAt.getTime() < EVERY_MS) return null;
  const number = (last?.number ?? 0) + 1;
  await db.workspaceRevision.create({ data: { userId, attemptId, position, number, data: data as Prisma.InputJsonValue } });
  const old = await db.workspaceRevision.findMany({ where: { attemptId, position, userId }, orderBy: { number: "desc" }, skip: KEEP, select: { id: true } });
  if (old.length) await db.workspaceRevision.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  return number;
}

export const listRevisions = (userId: string, attemptId: string, position: number) =>
  db.workspaceRevision.findMany({ where: { userId, attemptId, position }, orderBy: { number: "desc" }, select: { number: true, createdAt: true }, take: KEEP });

export async function getRevision(userId: string, attemptId: string, position: number, number: number) {
  const r = await db.workspaceRevision.findFirst({ where: { userId, attemptId, position, number }, select: { data: true, createdAt: true } });
  if (!r) throw new ApiHttpError("Version introuvable.", 404);
  return r;
}
