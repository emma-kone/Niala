import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import type { AdminUser } from "@/server/admin/session";
import { getSetting } from "@/server/admin/settings";

// Communications aux étudiants : annonces ciblées par critères autorisés (catégorie, niveau, établissement),
// avec aperçu, confirmation, plafond quotidien et historique. Elles arrivent comme notifications dans Niala.

export const ANNOUNCEMENT_KINDS = { INFO: "Information générale", FEATURE: "Nouvelle fonctionnalité", MAINTENANCE: "Maintenance", ALERT: "Alerte importante" } as const;
const KIND_KEYS = Object.keys(ANNOUNCEMENT_KINDS) as [keyof typeof ANNOUNCEMENT_KINDS, ...(keyof typeof ANNOUNCEMENT_KINDS)[]];

export const audienceSchema = z.object({
  categories: z.array(z.enum(["ESATIC", "OTHER_SCHOOL", "TESTER"])).max(3).optional(),
  institutions: z.array(z.string().trim().max(120)).max(20).optional(),
});
export type Audience = z.infer<typeof audienceSchema>;

export const announcementSchema = z.object({
  kind: z.enum(KIND_KEYS),
  title: z.string().trim().min(3, "Donnez un titre (3 caractères minimum).").max(100, "Titre trop long (100 caractères maximum)."),
  body: z.string().trim().min(5, "Rédigez le message.").max(1000, "Message trop long (1000 caractères maximum)."),
  audience: audienceSchema.default({}),
});

function audienceWhere(a: Audience): Prisma.UserWhereInput {
  const profile: Prisma.StudentProfileWhereInput = {
    ...(a.categories?.length ? { category: { in: a.categories } } : {}),
    ...(a.institutions?.length ? { institution: { in: a.institutions } } : {}),
  };
  return { accountStatus: "ACTIVE", adminRole: null, ...(Object.keys(profile).length ? { profile: { is: profile } } : {}) };
}

export async function countAudience(raw: unknown): Promise<number> {
  return db.user.count({ where: audienceWhere(audienceSchema.parse(raw ?? {})) });
}

export async function previewAnnouncement(raw: unknown) {
  const input = announcementSchema.parse(raw);
  const recipients = await db.user.count({ where: audienceWhere(input.audience) });
  const limit = await getSetting("announcements.dailyLimit");
  const sentToday = await db.announcement.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } });
  return { recipients, kindLabel: ANNOUNCEMENT_KINDS[input.kind], remainingToday: Math.max(0, limit - sentToday), dailyLimit: limit };
}

/** Diffuse l'annonce. Refuse un plafond quotidien dépassé, un doublon récent ou une audience vide. */
export async function publishAnnouncement(admin: AdminUser, raw: unknown) {
  const body = z.object({ confirm: z.literal(true, { error: "Confirmez la diffusion." }) }).and(announcementSchema).parse(raw);
  const { confirm: _c, ...input } = body;
  void _c;
  const limit = await getSetting("announcements.dailyLimit");
  const since = new Date(Date.now() - 24 * 3_600_000);
  if ((await db.announcement.count({ where: { createdAt: { gte: since } } })) >= limit) throw new ApiHttpError(`Plafond atteint : ${limit} annonce(s) par 24 heures, pour éviter les notifications abusives.`, 429);
  if (await db.announcement.findFirst({ where: { title: input.title, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })) throw new ApiHttpError("Une annonce de même titre vient d'être diffusée.", 409);

  const users = await db.user.findMany({ where: audienceWhere(input.audience), select: { id: true } });
  if (!users.length) throw new ApiHttpError("Aucun destinataire ne correspond à ces critères.", 422);

  const announcement = await db.announcement.create({ data: { kind: input.kind, title: input.title, body: input.body, audience: input.audience as Prisma.InputJsonValue, recipientCount: users.length, createdById: admin.id } });
  for (let i = 0; i < users.length; i += 1000) {
    await db.userNotification.createMany({ data: users.slice(i, i + 1000).map((u) => ({ userId: u.id, kind: "ANNOUNCEMENT", title: input.title, body: input.body, refId: announcement.id })) });
  }
  await audit(admin, "announcement.publish", { targetType: "announcement", targetId: announcement.id, detail: { kind: input.kind, title: input.title, recipients: users.length, audience: input.audience } });
  return { id: announcement.id, recipients: users.length };
}

export async function listAnnouncements(limit = 30) {
  return db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function audienceOptions() {
  const [institutions] = await Promise.all([
    db.studentProfile.findMany({ where: { institution: { not: null } }, select: { institution: true }, distinct: ["institution"], orderBy: { institution: "asc" }, take: 100 }),
  ]);
  return { institutions: institutions.map((i) => i.institution!) };
}
