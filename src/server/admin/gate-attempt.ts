import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import { verifyAccessCode } from "@/server/admin/gate";

// Tentative de saisie du code d'accès : limitée par adresse IP et globalement (en base, donc valable même sur plusieurs
// instances serverless), journalisée, et ralentie en cas d'échec.

export const GATE_WINDOW_MS = 15 * 60_000;
export const GATE_MAX_PER_IP = 5;
export const GATE_MAX_GLOBAL = 20;

export type GateResult = { ok: true } | { ok: false; reason: "wrong" | "locked" };

export async function attemptGate(code: string, ip: string | null): Promise<GateResult> {
  const since = new Date(Date.now() - GATE_WINDOW_MS);
  const [byIp, global] = await Promise.all([
    ip ? db.adminAuditLog.count({ where: { action: "admin.gate_failed", createdAt: { gte: since }, detail: { path: ["ip"], equals: ip } } }) : Promise.resolve(0),
    db.adminAuditLog.count({ where: { action: "admin.gate_failed", createdAt: { gte: since } } }),
  ]);
  if (byIp >= GATE_MAX_PER_IP || global >= GATE_MAX_GLOBAL) {
    await audit(null, "admin.gate_failed", { targetType: "gate", result: "DENIED", detail: { ip, reason: "locked" } });
    return { ok: false, reason: "locked" };
  }
  if (verifyAccessCode(code)) {
    await audit(null, "admin.gate", { targetType: "gate", detail: { ip } });
    return { ok: true };
  }
  await audit(null, "admin.gate_failed", { targetType: "gate", result: "FAILED", detail: { ip, reason: "wrong" } });
  return { ok: false, reason: "wrong" };
}
