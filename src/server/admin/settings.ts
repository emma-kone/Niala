import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import { ADMIN_ROLES, ROLE_LABELS, isAdminRole, type AdminRole } from "@/server/admin/rbac";
import type { AdminUser } from "@/server/admin/session";

// Paramètres globaux du back-office (lisibles par les administrateurs, modifiables par le super administrateur)
// et gestion des rôles d'administration.

export const SETTING_DEFS = {
  "announcements.dailyLimit": { label: "Annonces maximum par 24 heures", description: "Plafond contre les notifications abusives.", default: 3, schema: z.number().int().min(1).max(20) },
  "requests.dailyPerUser": { label: "Demandes maximum par étudiant et par 24 heures", description: "Limite l'envoi de demandes en rafale.", default: 10, schema: z.number().int().min(1).max(50) },
  "alerts.enabled": { label: "Alertes automatiques de supervision", description: "Détection des erreurs, lenteurs et pics d'IA.", default: true, schema: z.boolean() },
} as const;
export type SettingKey = keyof typeof SETTING_DEFS;
type ValueOf<K extends SettingKey> = (typeof SETTING_DEFS)[K]["default"] extends number ? number : boolean;

export async function getSetting<K extends SettingKey>(key: K): Promise<ValueOf<K>> {
  const row = await db.adminSetting.findUnique({ where: { key: key as string } });
  const parsed = SETTING_DEFS[key].schema.safeParse(row?.value);
  return (parsed.success ? parsed.data : SETTING_DEFS[key].default) as ValueOf<K>;
}

export async function listSettings() {
  const rows = await db.adminSetting.findMany();
  return (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => {
    const def = SETTING_DEFS[key];
    const row = rows.find((r) => r.key === key);
    const parsed = def.schema.safeParse(row?.value);
    return { key, label: def.label, description: def.description, value: parsed.success ? parsed.data : def.default, isDefault: !parsed.success, kind: typeof def.default === "boolean" ? ("boolean" as const) : ("number" as const), updatedAt: row?.updatedAt ?? null };
  });
}

export async function updateSetting(admin: AdminUser, key: string, value: unknown) {
  if (!(key in SETTING_DEFS)) throw new ApiHttpError("Paramètre inconnu.", 404);
  const def = SETTING_DEFS[key as SettingKey];
  const parsed = def.schema.safeParse(value);
  if (!parsed.success) throw new ApiHttpError(parsed.error.issues[0]?.message ?? "Valeur invalide.", 422);
  const before = await getSetting(key as SettingKey);
  await db.adminSetting.upsert({ where: { key }, create: { key, value: parsed.data, updatedById: admin.id }, update: { value: parsed.data, updatedById: admin.id } });
  await audit(admin, "setting.update", { targetType: "setting", targetId: key, detail: { from: before, to: parsed.data } });
  return { ok: true };
}

// ── Rôles d'administration ───────────────────────────────────────────────────

export async function listAdmins() {
  const rows = await db.user.findMany({ where: { adminRole: { not: null } }, select: { id: true, email: true, name: true, adminRole: true, accountStatus: true, createdAt: true }, orderBy: { email: "asc" } });
  return rows.map((r) => ({ ...r, role: r.adminRole as AdminRole, roleLabel: isAdminRole(r.adminRole) ? ROLE_LABELS[r.adminRole] : "—" }));
}

export const roleSchema = z.object({ email: z.string().trim().email(), role: z.enum([...ADMIN_ROLES, "NONE"] as [string, ...string[]]) });

/** Attribue, change ou retire un rôle d'administration à un compte existant. Réservé au super administrateur. */
export async function setAdminRole(admin: AdminUser, raw: unknown) {
  const { email, role } = roleSchema.parse(raw);
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, email: true, adminRole: true, accountStatus: true } });
  if (!user) throw new ApiHttpError("Aucun compte Niala ne porte cette adresse : la personne doit d'abord s'inscrire.", 404);
  if (user.id === admin.id) throw new ApiHttpError("Vous ne pouvez pas modifier votre propre rôle.", 403);
  if (role !== "NONE" && user.accountStatus !== "ACTIVE") throw new ApiHttpError("Ce compte est suspendu ou désactivé.", 409);
  if (user.adminRole === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    const supers = await db.user.count({ where: { adminRole: "SUPER_ADMIN" } });
    if (supers <= 1) throw new ApiHttpError("Il doit toujours rester un super administrateur.", 409);
  }
  const next = role === "NONE" ? null : role;
  await db.user.update({ where: { id: user.id }, data: { adminRole: next, ...(next ? {} : { sessionVersion: { increment: 1 } }) } });
  await audit(admin, "admin.role", { targetType: "user", targetId: user.id, detail: { email: user.email, from: user.adminRole, to: next } });
  return { ok: true };
}
