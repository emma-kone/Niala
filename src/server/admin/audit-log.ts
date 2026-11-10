import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";

export const AUDIT_PAGE_SIZE = 40;

export const auditFilterSchema = z.object({
  action: z.string().trim().max(60).optional(),
  result: z.enum(["SUCCESS", "DENIED", "FAILED"]).optional(),
  actor: z.string().trim().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});

/** Lecture seule du journal d'audit (il n'existe aucune fonction de modification ni de suppression). */
export async function listAudit(raw: unknown) {
  const f = auditFilterSchema.parse(raw);
  const where: Prisma.AdminAuditLogWhereInput = {
    ...(f.action ? { action: f.action } : {}),
    ...(f.result ? { result: f.result } : {}),
    ...(f.actor ? { actorEmail: { contains: f.actor, mode: "insensitive" } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}), ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + 86_400_000) } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.adminAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: AUDIT_PAGE_SIZE, skip: (f.page - 1) * AUDIT_PAGE_SIZE }),
    db.adminAuditLog.count({ where }),
  ]);
  return { rows, total, page: f.page, pages: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)), query: f };
}
