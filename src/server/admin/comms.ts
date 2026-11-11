import { timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { hmacFor } from "@/lib/auth";
import { db, dbAll } from "@/lib/db";
import { softDelete } from "@/lib/soft-delete";
import { audit } from "@/server/admin/audit";
import type { AdminUser } from "@/server/admin/session";
import { getSetting } from "@/server/admin/settings";
import { emailConfigured, emailHtml, sendEmailBatch, type Email } from "@/server/email";
import { pushConfigured, sendPushToUsers } from "@/server/push";

// Communications aux étudiants : annonces à TOUS les comptes actifs ou ciblées (catégorie, établissement), avec aperçu,
// confirmation, plafond quotidien et historique. Canaux : notification dans Niala (toujours), e-mail et notification
// push sur les appareils (même site fermé), au choix. Une annonce peut être supprimée : elle disparaît des notifications
// des étudiants (les e-mails et notifications push déjà reçus ne peuvent pas être repris).

export const ANNOUNCEMENT_KINDS = { INFO: "Information générale", FEATURE: "Nouvelle fonctionnalité", MAINTENANCE: "Maintenance", ALERT: "Alerte importante" } as const;
const KIND_KEYS = Object.keys(ANNOUNCEMENT_KINDS) as [keyof typeof ANNOUNCEMENT_KINDS, ...(keyof typeof ANNOUNCEMENT_KINDS)[]];

export const audienceSchema = z.object({
  categories: z.array(z.enum(["ESATIC", "OTHER_SCHOOL", "TESTER"])).max(3).optional(),
  institutions: z.array(z.string().trim().max(120)).max(20).optional(),
});
export type Audience = z.infer<typeof audienceSchema>;

export const channelsSchema = z.object({ email: z.boolean().default(false), push: z.boolean().default(false) }).default({ email: false, push: false });
export type Channels = z.infer<typeof channelsSchema>;

export const announcementSchema = z.object({
  kind: z.enum(KIND_KEYS),
  title: z.string().trim().min(3, "Donnez un titre (3 caractères minimum).").max(100, "Titre trop long (100 caractères maximum)."),
  body: z.string().trim().min(5, "Rédigez le message.").max(1000, "Message trop long (1000 caractères maximum)."),
  /** « all » : tous les comptes actifs. « targeted » : selon `audience` (au moins un critère). Absent : audience vide = tous. */
  target: z.enum(["all", "targeted"]).optional(),
  audience: audienceSchema.default({}),
  channels: channelsSchema,
});

/** Audience effective : « tous » ignore les critères ; une audience ciblée sans critère est refusée (ambiguë). */
function effectiveAudience(input: { target?: "all" | "targeted"; audience: Audience }): Audience {
  if (input.target === "all") return {};
  if (input.target === "targeted" && !input.audience.categories?.length && !input.audience.institutions?.length) throw new ApiHttpError("Choisissez au moins une catégorie ou un établissement, ou « Tous les utilisateurs actifs ».", 422);
  return input.audience;
}

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

/** Annonces publiées sur 24 h, y compris celles supprimées depuis : supprimer n'offre pas un envoi de plus. */
const sentLast24h = () => dbAll.announcement.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } });

export async function previewAnnouncement(raw: unknown) {
  const input = announcementSchema.parse(raw);
  const where = audienceWhere(effectiveAudience(input));
  const [recipients, withEmail, withPush, limit, sentToday] = await Promise.all([
    db.user.count({ where }),
    db.user.count({ where: { ...where, OR: [{ settings: { is: null } }, { settings: { is: { emailAnnouncements: true } } }] } }),
    db.user.count({ where: { ...where, pushSubscriptions: { some: {} } } }),
    getSetting("announcements.dailyLimit"),
    sentLast24h(),
  ]);
  return {
    recipients,
    kindLabel: ANNOUNCEMENT_KINDS[input.kind],
    remainingToday: Math.max(0, limit - sentToday),
    dailyLimit: limit,
    email: { configured: emailConfigured(), reachable: withEmail },
    push: { configured: pushConfigured(), reachable: withPush },
  };
}

/** Diffuse l'annonce dans Niala. Refuse un plafond quotidien dépassé, un doublon récent ou une audience vide. Les e-mails et push partent ensuite (`deliverAnnouncement`). */
export async function publishAnnouncement(admin: AdminUser, raw: unknown) {
  const body = z.object({ confirm: z.literal(true, { error: "Confirmez la diffusion." }) }).and(announcementSchema).parse(raw);
  const { confirm: _c, ...input } = body;
  void _c;
  const audience = effectiveAudience(input);
  const limit = await getSetting("announcements.dailyLimit");
  if ((await sentLast24h()) >= limit) throw new ApiHttpError(`Plafond atteint : ${limit} annonce(s) par 24 heures, pour éviter les notifications abusives.`, 429);
  if (await db.announcement.findFirst({ where: { title: input.title, createdAt: { gte: new Date(Date.now() - 3_600_000) } } })) throw new ApiHttpError("Une annonce de même titre vient d'être diffusée.", 409);

  const users = await db.user.findMany({ where: audienceWhere(audience), select: { id: true } });
  if (!users.length) throw new ApiHttpError("Aucun destinataire ne correspond à ces critères.", 422);

  const announcement = await db.announcement.create({ data: { kind: input.kind, title: input.title, body: input.body, audience: audience as Prisma.InputJsonValue, channels: input.channels as Prisma.InputJsonValue, recipientCount: users.length, createdById: admin.id } });
  for (let i = 0; i < users.length; i += 1000) {
    await db.userNotification.createMany({ data: users.slice(i, i + 1000).map((u) => ({ userId: u.id, kind: "ANNOUNCEMENT", title: input.title, body: input.body, refId: announcement.id })) });
  }
  await audit(admin, "announcement.publish", { targetType: "announcement", targetId: announcement.id, detail: { kind: input.kind, title: input.title, recipients: users.length, audience: input.target === "all" ? "all" : audience, channels: input.channels } });
  return { id: announcement.id, recipients: users.length, channels: input.channels };
}

// ── Envoi hors du site : e-mail et notifications push ────────────────────────

/** Lien de désinscription des annonces par e-mail (signé, sans connexion). */
export const unsubscribeToken = (userId: string) => `${userId}.${hmacFor("announce-unsub", userId).slice(0, 32)}`;

export async function unsubscribeFromEmails(token: string) {
  const [userId] = token.split(".");
  const expected = Buffer.from(unsubscribeToken(userId ?? ""));
  const given = Buffer.from(token);
  if (!userId || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ApiHttpError("Lien de désinscription invalide.", 404);
  await db.userSettings.upsert({ where: { userId }, create: { userId, emailAnnouncements: false }, update: { emailAnnouncements: false } });
  return { ok: true };
}

/** Envoie l'annonce par e-mail et/ou push selon les canaux choisis, puis enregistre le nombre de personnes atteintes. */
export async function deliverAnnouncement(id: string, origin: string) {
  const a = await db.announcement.findUnique({ where: { id } });
  if (!a) return { emailSent: 0, pushSent: 0 };
  const channels = channelsSchema.parse(a.channels ?? {});
  const where = audienceWhere(audienceSchema.parse(a.audience ?? {}));
  const kind = ANNOUNCEMENT_KINDS[a.kind as keyof typeof ANNOUNCEMENT_KINDS] ?? "Annonce";
  let emailSent = 0;
  let pushSent = 0;

  if (channels.email && emailConfigured()) {
    // Seuls les étudiants qui n'ont pas refusé les annonces par e-mail.
    const users = await db.user.findMany({ where: { ...where, OR: [{ settings: { is: null } }, { settings: { is: { emailAnnouncements: true } } }] }, select: { id: true, email: true, name: true } });
    const emails: Email[] = users.map((u) => {
      const unsub = `${origin}/desinscription?t=${encodeURIComponent(unsubscribeToken(u.id))}`;
      const oneClick = `${origin}/api/desinscription?t=${encodeURIComponent(unsubscribeToken(u.id))}`;
      return {
        to: u.email,
        subject: `Niala — ${a.title}`,
        text: `${kind}\n\n${a.title}\n\n${a.body}\n\nOuvrir Niala : ${origin}\n\nNe plus recevoir les annonces par e-mail : ${unsub}`,
        html: emailHtml({ title: a.title, paragraphs: [`${u.name ? `Bonjour ${u.name},` : "Bonjour,"}`, a.body], button: { label: "Ouvrir Niala", url: origin }, footer: `${kind} de l'équipe Niala. <a href="${unsub}" style="color:#6b6478">Ne plus recevoir les annonces par e-mail</a>.` }),
        headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      };
    });
    emailSent = await sendEmailBatch(emails, `annonce ${a.id}`);
  }

  if (channels.push && pushConfigured()) {
    const users = await db.user.findMany({ where: { ...where, pushSubscriptions: { some: {} } }, select: { id: true } });
    pushSent = await sendPushToUsers(users.map((u) => u.id), { title: a.title, body: a.body, url: "/", tag: `announcement-${a.id}` });
  }

  await db.announcement.update({ where: { id }, data: { emailSent, pushSent } });
  return { emailSent, pushSent };
}

/** Supprime une annonce : retirée de l'historique et des notifications des étudiants (conservée en base pour les statistiques). */
export async function deleteAnnouncement(admin: AdminUser, id: string) {
  const a = await db.announcement.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!a) throw new ApiHttpError("Annonce introuvable.", 404);
  const removed = await db.$transaction(async (tx) => {
    await softDelete(tx, "Announcement", { id });
    return (await tx.userNotification.deleteMany({ where: { kind: "ANNOUNCEMENT", refId: id } })).count;
  });
  await audit(admin, "announcement.delete", { targetType: "announcement", targetId: id, detail: { title: a.title, notificationsRemoved: removed } });
  return { ok: true, notificationsRemoved: removed };
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
