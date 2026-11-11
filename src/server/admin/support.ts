import { randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { hmacFor } from "@/lib/auth";
import { db } from "@/lib/db";
import { softDelete } from "@/lib/soft-delete";
import { emailHtml, trySendEmail } from "@/server/email";
import { audit } from "@/server/admin/audit";
import type { AdminUser } from "@/server/admin/session";
import { bucketSql, cached, fillSeries, n, periodKey, ratio, round1, type Period } from "@/server/admin/stats/common";
import { CLOSED_STATUSES, MODULES, PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES, ROADMAP_STATUSES, type RequestStatus } from "@/server/analytics/definitions";
import { track } from "@/server/analytics/track";
import { foldText } from "@/server/ai/guard";
import { getSetting } from "@/server/admin/settings";
import { getStorage } from "@/server/storage";

// ─────────────────────────────────────────────────────────────────────────────
// Suggestions, signalements et demandes d'assistance : côté étudiant (dépôt, suivi, réponses) et côté administration
// (traitement, notes internes, feuille de route). Les notes internes ne sont JAMAIS renvoyées côté étudiant : toutes les
// lectures étudiantes filtrent explicitement `internal = false`.
// ─────────────────────────────────────────────────────────────────────────────

const TYPES = Object.keys(REQUEST_TYPES) as [keyof typeof REQUEST_TYPES, ...(keyof typeof REQUEST_TYPES)[]];
const STATUS_KEYS = Object.keys(REQUEST_STATUSES) as [RequestStatus, ...RequestStatus[]];
const PRIORITY_KEYS = Object.keys(PRIORITIES) as [keyof typeof PRIORITIES, ...(keyof typeof PRIORITIES)[]];

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt" };

export const requestInputSchema = z.object({
  type: z.enum(TYPES, { error: "Choisissez le type de demande." }),
  subject: z.string().trim().min(3, "Indiquez l'objet de votre demande (3 caractères minimum).").max(120, "Objet trop long (120 caractères maximum)."),
  description: z.string().trim().min(10, "Décrivez votre demande (10 caractères minimum).").max(5000, "Description trop longue (5000 caractères maximum)."),
  module: z.string().trim().max(40).optional().transform((v) => v || undefined),
  urgency: z.enum(["LOW", "NORMAL", "HIGH"]).optional(),
});

/** `key` absente : fichier retiré du stockage avec le compte de son auteur (anonymisation). */
export interface Attachment { key: string | null; name: string; mime: string; size: number; removed?: boolean }

/** Vérifie un fichier joint : taille, type déclaré et signature réelle (un .exe renommé en .png est refusé). */
export function checkAttachment(name: string, mime: string, data: Buffer): void {
  if (!ATTACHMENT_MIME[mime]) throw new ApiHttpError("Format de fichier non accepté (PNG, JPEG, WebP, PDF ou texte).", 422);
  if (data.length === 0) throw new ApiHttpError(`Le fichier « ${name} » est vide.`, 422);
  if (data.length > MAX_ATTACHMENT_BYTES) throw new ApiHttpError(`Le fichier « ${name} » dépasse 5 Mo.`, 422);
  const head = data.subarray(0, 12);
  const ok =
    (mime === "image/png" && head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
    (mime === "image/jpeg" && head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
    (mime === "image/webp" && head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") ||
    (mime === "application/pdf" && head.subarray(0, 4).toString() === "%PDF") ||
    (mime === "text/plain" && !data.subarray(0, 2000).includes(0));
  if (!ok) throw new ApiHttpError(`Le contenu de « ${name} » ne correspond pas à son format.`, 422);
}

const safeName = (name: string) => name.replace(/[^\w.\- àâäçéèêëîïôöùûüÿ]/gi, "_").slice(0, 80) || "fichier";

async function nextReference(): Promise<string> {
  const d = new Date();
  const prefix = `NL-${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, "0")}-`;
  const count = await db.supportRequest.count({ where: { reference: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

export interface UploadedFile { name: string; mime: string; data: Buffer }

/** Dépôt d'une demande : la référence de suivi est générée, la demande est rattachée au compte, l'e-mail n'est jamais redemandé. */
export async function submitRequest(userId: string, raw: unknown, files: UploadedFile[] = []) {
  const input = requestInputSchema.parse(raw);
  if (input.module && !(input.module in MODULES) && input.module !== "other") throw new ApiHttpError("Module inconnu.", 422);
  if (files.length > MAX_ATTACHMENTS) throw new ApiHttpError(`${MAX_ATTACHMENTS} fichiers au maximum.`, 422);
  for (const f of files) checkAttachment(f.name, f.mime, f.data);
  const sentToday = await db.supportRequest.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } });
  if (sentToday >= (await getSetting("requests.dailyPerUser"))) throw new ApiHttpError("Vous avez déjà envoyé de nombreuses demandes aujourd'hui. Patientez avant d'en envoyer une nouvelle.", 429);

  let created: { id: string; reference: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    try {
      const reference = await nextReference();
      created = await db.supportRequest.create({
        data: { reference: attempt ? `${reference}-${randomBytes(2).toString("hex")}` : reference, userId, type: input.type, subject: input.subject, description: input.description, module: input.module ?? null, urgency: input.urgency ?? null, status: "RECEIVED", priority: input.urgency === "HIGH" ? "HIGH" : "NORMAL" },
        select: { id: true, reference: true },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  if (!created) throw new ApiHttpError("Impossible d'enregistrer la demande pour le moment. Réessayez.", 503);

  if (files.length) {
    const storage = getStorage();
    const stored: Attachment[] = [];
    try {
      for (const f of files) {
        const key = `${userId}/${created.id}/support/${randomBytes(8).toString("hex")}`;
        await storage.put(key, f.data, f.mime);
        stored.push({ key, name: safeName(f.name), mime: f.mime, size: f.data.length });
      }
      await db.supportRequest.update({ where: { id: created.id }, data: { attachments: stored as unknown as Prisma.InputJsonValue } });
    } catch (e) {
      await storage.remove(stored.map((s) => s.key).filter((k): k is string => !!k)).catch(() => undefined);
      await db.supportRequest.delete({ where: { id: created.id } }).catch(() => undefined);
      console.error("[support] pièces jointes non enregistrées :", e instanceof Error ? e.message : e);
      throw new ApiHttpError("Les pièces jointes n'ont pas pu être enregistrées. Réessayez ou envoyez la demande sans fichier.", 503);
    }
  }
  track(userId, "suggestion.submit", { module: "settings", sourceRef: created.id, props: { type: input.type, module: input.module ?? null, attachments: files.length } });
  return { id: created.id, reference: created.reference };
}

/**
 * Demande créée par Niala pour le compte d'un étudiant (ex. « mot de passe oublié » sans envoi d'e-mail configuré) :
 * elle apparaît dans la file de l'équipe et dans « Suggestions » de l'étudiant. Une seule demande ouverte du même objet à la fois.
 */
export async function fileSystemRequest(userId: string, subject: string, description: string) {
  const open = await db.supportRequest.findFirst({ where: { userId, subject, status: { notIn: [...CLOSED_STATUSES] } }, select: { id: true, reference: true } });
  if (open) return open;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const reference = await nextReference();
      return await db.supportRequest.create({
        data: { reference: attempt ? `${reference}-${randomBytes(2).toString("hex")}` : reference, userId, type: "ASSISTANCE", subject, description, module: null, status: "RECEIVED", priority: "HIGH" },
        select: { id: true, reference: true },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  return null;
}

// ── Côté étudiant ────────────────────────────────────────────────────────────

const messageForUser = { where: { internal: false }, orderBy: { createdAt: "asc" as const }, select: { id: true, authorRole: true, authorName: true, body: true, createdAt: true } };

export async function listMyRequests(userId: string) {
  const rows = await db.supportRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, reference: true, type: true, subject: true, status: true, createdAt: true, updatedAt: true, _count: { select: { messages: { where: { internal: false, authorRole: "ADMIN" } } } } } });
  return rows.map((r) => ({ id: r.id, reference: r.reference, type: r.type, subject: r.subject, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, replies: r._count.messages }));
}

/** Réponses reçues de l'équipe, toutes demandes confondues (jamais les notes internes), de la plus récente à la plus ancienne. */
export async function listMyReplies(userId: string) {
  const rows = await db.supportMessage.findMany({
    where: { internal: false, authorRole: "ADMIN", request: { userId } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, body: true, createdAt: true, request: { select: { id: true, reference: true, subject: true, status: true } } },
  });
  return rows.map((m) => ({ id: m.id, body: m.body, createdAt: m.createdAt, requestId: m.request.id, reference: m.request.reference, subject: m.request.subject, status: m.request.status }));
}

export async function getMyRequest(userId: string, id: string) {
  const r = await db.supportRequest.findFirst({ where: { id, userId }, select: { id: true, reference: true, type: true, subject: true, description: true, module: true, urgency: true, status: true, attachments: true, createdAt: true, updatedAt: true, messages: messageForUser } });
  if (!r) throw new ApiHttpError("Demande introuvable.", 404);
  return { ...r, attachments: ((r.attachments as Attachment[] | null) ?? []).map((a, i) => ({ index: i, name: a.name, mime: a.mime, size: a.size })) };
}

export async function replyAsUser(userId: string, id: string, bodyRaw: unknown) {
  const body = z.string().trim().min(2, "Écrivez votre message.").max(4000, "Message trop long.").parse(bodyRaw);
  const r = await db.supportRequest.findFirst({ where: { id, userId }, select: { status: true } });
  if (!r) throw new ApiHttpError("Demande introuvable.", 404);
  if (CLOSED_STATUSES.includes(r.status as RequestStatus)) throw new ApiHttpError("Cette demande est clôturée. Envoyez une nouvelle demande si besoin.", 409);
  const author = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  await db.$transaction([
    db.supportMessage.create({ data: { requestId: id, authorId: userId, authorRole: "USER", authorName: author?.name ?? null, body } }),
    // Une réponse à une demande d'information remet la demande dans la file de traitement.
    db.supportRequest.update({ where: { id }, data: r.status === "NEEDS_INFO" ? { status: "PENDING_REVIEW" } : { updatedAt: new Date() } }),
  ]);
  return { ok: true };
}

export async function readAttachment(requestId: string, index: number, scope: { userId?: string }) {
  const r = await db.supportRequest.findFirst({ where: { id: requestId, ...(scope.userId ? { userId: scope.userId } : {}) }, select: { attachments: true } });
  const att = ((r?.attachments as Attachment[] | null) ?? [])[index];
  if (!r || !att) throw new ApiHttpError("Pièce jointe introuvable.", 404);
  if (!att.key) throw new ApiHttpError("Ce fichier a été supprimé avec le compte de son auteur.", 410);
  return { ...att, data: await getStorage().read(att.key) };
}

// ── Notifications étudiantes ─────────────────────────────────────────────────

export async function notifyUser(userId: string, data: { kind: "ANNOUNCEMENT" | "REQUEST_UPDATE" | "REQUEST_REPLY"; title: string; body?: string; link?: string; refId?: string }) {
  await db.userNotification.create({ data: { userId, kind: data.kind, title: data.title, body: data.body ?? null, link: data.link ?? null, refId: data.refId ?? null } });
}

export async function listNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    db.userNotification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true } }),
    db.userNotification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  await db.userNotification.updateMany({ where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
  return { ok: true };
}

// ── Côté administration ──────────────────────────────────────────────────────

export const requestFilterSchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(TYPES).optional(),
  status: z.enum(STATUS_KEYS).optional(),
  priority: z.enum(PRIORITY_KEYS).optional(),
  module: z.string().trim().max(40).optional(),
  assignee: z.string().trim().max(40).optional(),
  open: z.enum(["1"]).optional(),
  sort: z.enum(["createdAt", "priority", "status", "type"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export const REQUEST_PAGE_SIZE = 20;
const PRIORITY_ORDER = Prisma.sql`CASE r.priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'NORMAL' THEN 2 ELSE 1 END`;

export async function requestCounts() {
  const rows = await db.supportRequest.groupBy({ by: ["status"], _count: { _all: true } });
  const by = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const urgent = await db.supportRequest.count({ where: { priority: "URGENT", status: { notIn: CLOSED_STATUSES } } });
  return { total: rows.reduce((s, r) => s + r._count._all, 0), received: by("RECEIVED"), pending: by("PENDING_REVIEW"), inProgress: by("IN_PROGRESS"), needsInfo: by("NEEDS_INFO"), resolved: by("RESOLVED"), rejected: by("REJECTED"), urgent };
}

export async function listRequests(raw: unknown) {
  const f = requestFilterSchema.parse(raw);
  // Les demandes supprimées par l'équipe restent en base (statistiques) mais ne sont plus listées.
  const where: Prisma.Sql[] = [Prisma.sql`r."deletedAt" IS NULL`];
  if (f.q) {
    const like = `%${f.q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    where.push(Prisma.sql`(lower(r.reference) LIKE ${like} OR lower(r.subject) LIKE ${like} OR lower(r.description) LIKE ${like} OR lower(coalesce(u.email, r."guestEmail", '')) LIKE ${like} OR lower(coalesce(u.name, r."guestName", '')) LIKE ${like})`);
  }
  if (f.type) where.push(Prisma.sql`r.type = ${f.type}`);
  if (f.status) where.push(Prisma.sql`r.status = ${f.status}`);
  if (f.priority) where.push(Prisma.sql`r.priority = ${f.priority}`);
  if (f.module) where.push(Prisma.sql`r.module = ${f.module}`);
  if (f.assignee) where.push(f.assignee === "none" ? Prisma.sql`r."assigneeId" IS NULL` : Prisma.sql`r."assigneeId" = ${f.assignee}`);
  if (f.open) where.push(Prisma.sql`r.status NOT IN ('RESOLVED','REJECTED')`);
  const sortSql = { createdAt: Prisma.sql`r."createdAt"`, priority: PRIORITY_ORDER, status: Prisma.sql`r.status`, type: Prisma.sql`r.type` }[f.sort];
  const dir = f.dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const rows = await db.$queryRaw<{ id: string; reference: string; type: string; subject: string; description: string; module: string | null; priority: string; status: string; createdAt: Date; userId: string | null; userName: string | null; userEmail: string; guest: boolean; assigneeId: string | null; roadmapItemId: string | null; total: bigint }[]>`
    SELECT r.id, r.reference, r.type, r.subject, r.description, r.module, r.priority, r.status, r."createdAt", r."userId",
           coalesce(u.name, r."guestName") AS "userName", coalesce(u.email, r."guestEmail", '') AS "userEmail", (r."userId" IS NULL) AS guest,
           r."assigneeId", r."roadmapItemId", count(*) OVER () AS total
    FROM "SupportRequest" r LEFT JOIN "User" u ON u.id = r."userId"
    WHERE ${Prisma.join(where, " AND ")} ORDER BY ${sortSql} ${dir}, r.id LIMIT ${REQUEST_PAGE_SIZE} OFFSET ${(f.page - 1) * REQUEST_PAGE_SIZE}`;
  const total = rows.length ? n(rows[0].total) : 0;
  return { rows: rows.map(({ total: _t, ...r }) => (void _t, r)), total, page: f.page, pages: Math.max(1, Math.ceil(total / REQUEST_PAGE_SIZE)), query: f };
}

export async function getRequestAdmin(admin: AdminUser, id: string) {
  const r = await db.supportRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, accountStatus: true, profile: { select: { category: true, institution: true, field: true } } } }, messages: { orderBy: { createdAt: "asc" } }, roadmapItem: { select: { id: true, title: true, status: true } } },
  });
  if (!r) throw new ApiHttpError("Demande introuvable.", 404);
  const assignee = r.assigneeId ? await db.user.findUnique({ where: { id: r.assigneeId }, select: { id: true, name: true, email: true } }) : null;
  void admin;
  return { ...r, attachments: ((r.attachments as Attachment[] | null) ?? []).map((a, i) => ({ index: i, name: a.name, mime: a.mime, size: a.size })), assignee, similar: await similarRequests(r.id) };
}

export async function assignableAdmins() {
  return db.user.findMany({ where: { adminRole: { in: ["SUPER_ADMIN", "ADMIN", "SUPPORT"] }, accountStatus: "ACTIVE" }, select: { id: true, name: true, email: true, adminRole: true }, orderBy: { email: "asc" } });
}

const words = (t: string) => new Set(foldText(t).split(" ").filter((w) => w.length >= 4).map((w) => w.slice(0, 6)));
export function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / (x.size + y.size - common);
}

/** Demandes proches (même sujet probable) : SUGGESTION de regroupement, que l'administrateur valide ou non. */
export async function similarRequests(id: string) {
  const base = await db.supportRequest.findUnique({ where: { id }, select: { type: true, subject: true, description: true, module: true } });
  if (!base) return [];
  const others = await db.supportRequest.findMany({ where: { id: { not: id }, type: base.type, ...(base.module ? { module: base.module } : {}) }, orderBy: { createdAt: "desc" }, take: 150, select: { id: true, reference: true, subject: true, description: true, status: true, roadmapItemId: true } });
  const text = `${base.subject} ${base.description}`;
  return others
    .map((o) => ({ id: o.id, reference: o.reference, subject: o.subject, status: o.status, roadmapItemId: o.roadmapItemId, score: Math.round(similarity(text, `${o.subject} ${o.description}`) * 100) }))
    .filter((o) => o.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export const updateRequestSchema = z.object({ status: z.enum(STATUS_KEYS).optional(), priority: z.enum(PRIORITY_KEYS).optional(), assigneeId: z.string().max(40).nullable().optional() });

export async function updateRequest(admin: AdminUser, id: string, raw: unknown, origin = defaultOrigin()) {
  const input = updateRequestSchema.parse(raw);
  const before = await db.supportRequest.findUnique({ where: { id }, select: { status: true, priority: true, assigneeId: true, userId: true, reference: true, subject: true, guestEmail: true, guestName: true, guestNonce: true } });
  if (!before) throw new ApiHttpError("Demande introuvable.", 404);
  if (input.assigneeId) {
    const a = await db.user.findUnique({ where: { id: input.assigneeId }, select: { adminRole: true } });
    if (!a || !["SUPER_ADMIN", "ADMIN", "SUPPORT"].includes(a.adminRole ?? "")) throw new ApiHttpError("Ce compte ne peut pas traiter les demandes.", 422);
  }
  const statusChanged = input.status && input.status !== before.status;
  await db.supportRequest.update({
    where: { id },
    data: {
      ...(input.status ? { status: input.status, closedAt: CLOSED_STATUSES.includes(input.status) ? new Date() : null } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    },
  });
  if (statusChanged) {
    await informRequester({ id, ...before }, { kind: "REQUEST_UPDATE", title: `Votre demande ${before.reference} : ${REQUEST_STATUSES[input.status!].toLowerCase()}`, origin });
  }
  await audit(admin, "request.update", { targetType: "request", targetId: id, detail: { reference: before.reference, ...(statusChanged ? { status: [before.status, input.status] } : {}), ...(input.priority && input.priority !== before.priority ? { priority: [before.priority, input.priority] } : {}), ...(input.assigneeId !== undefined && input.assigneeId !== before.assigneeId ? { assigneeId: input.assigneeId } : {}) } });
  return { ok: true };
}

export const replySchema = z.object({ body: z.string().trim().min(2, "Écrivez votre réponse.").max(4000, "Réponse trop longue."), status: z.enum(STATUS_KEYS).optional() });

/** Réponse visible par l'étudiant (avec notification dans Niala). */
export async function replyToRequest(admin: AdminUser, id: string, raw: unknown, origin = defaultOrigin()) {
  const input = replySchema.parse(raw);
  const r = await db.supportRequest.findUnique({ where: { id }, select: { userId: true, reference: true, subject: true, firstReplyAt: true, status: true, guestEmail: true, guestName: true, guestNonce: true } });
  if (!r) throw new ApiHttpError("Demande introuvable.", 404);
  const nextStatus = input.status ?? (r.status === "RECEIVED" || r.status === "PENDING_REVIEW" ? "IN_PROGRESS" : undefined);
  await db.$transaction([
    db.supportMessage.create({ data: { requestId: id, authorId: admin.id, authorRole: "ADMIN", authorName: "Équipe Niala", body: input.body } }),
    db.supportRequest.update({ where: { id }, data: { firstReplyAt: r.firstReplyAt ?? new Date(), ...(nextStatus ? { status: nextStatus, closedAt: CLOSED_STATUSES.includes(nextStatus) ? new Date() : null } : {}) } }),
  ]);
  const emailed = await informRequester({ id, ...r }, { kind: "REQUEST_REPLY", title: `Réponse à votre demande ${r.reference}`, message: input.body, origin });
  await audit(admin, "request.reply", { targetType: "request", targetId: id, detail: { reference: r.reference, ...(nextStatus && nextStatus !== r.status ? { status: [r.status, nextStatus] } : {}) } });
  return { ok: true, guest: !r.userId, emailed };
}

export async function addInternalNote(admin: AdminUser, id: string, bodyRaw: unknown) {
  const body = z.string().trim().min(2, "Écrivez la note.").max(4000).parse(bodyRaw);
  const r = await db.supportRequest.findUnique({ where: { id }, select: { reference: true } });
  if (!r) throw new ApiHttpError("Demande introuvable.", 404);
  await db.supportMessage.create({ data: { requestId: id, authorId: admin.id, authorRole: "ADMIN", authorName: admin.name ?? admin.email, internal: true, body } });
  await audit(admin, "request.note", { targetType: "request", targetId: id, detail: { reference: r.reference } });
  return { ok: true };
}

// ── Suppression et traitement groupé ─────────────────────────────────────────

export const bulkSchema = z.object({ ids: z.array(z.string().min(1).max(40)).min(1, "Sélectionnez au moins une demande.").max(100) });

/**
 * Suppression par l'équipe (spam, doublon, test…) : la demande et ses échanges disparaissent du back-office et de l'espace
 * de l'étudiant, mais restent en base pour les statistiques. Les pièces jointes restent dans le stockage privé.
 */
export async function deleteRequests(admin: AdminUser, raw: unknown) {
  const { ids } = bulkSchema.parse(raw);
  const rows = await db.supportRequest.findMany({ where: { id: { in: ids } }, select: { id: true, reference: true } });
  if (!rows.length) throw new ApiHttpError("Demande introuvable.", 404);
  await db.$transaction((tx) => softDelete(tx, "SupportRequest", { id: { in: rows.map((r) => r.id) } }));
  for (const r of rows) await audit(admin, "request.delete", { targetType: "request", targetId: r.id, detail: { reference: r.reference } });
  return { ok: true, deleted: rows.length };
}

export const bulkStatusSchema = bulkSchema.extend({ status: z.enum(STATUS_KEYS) });

/** Change le statut de plusieurs demandes (ex. clôturer une sélection). Chaque demandeur est informé comme pour un changement unitaire. */
export async function bulkUpdateStatus(admin: AdminUser, raw: unknown, origin = defaultOrigin()) {
  const { ids, status } = bulkStatusSchema.parse(raw);
  let updated = 0;
  for (const id of ids) {
    const current = await db.supportRequest.findUnique({ where: { id }, select: { status: true } });
    if (!current || current.status === status) continue;
    await updateRequest(admin, id, { status }, origin);
    updated++;
  }
  return { ok: true, updated };
}

// ── Demandeur : étudiant (notification dans Niala) ou visiteur sans compte (e-mail + lien de suivi) ──

const defaultOrigin = () => process.env.APP_URL?.trim().replace(/\/+$/, "") || "http://localhost:3000";

/** Lien de suivi d'un visiteur : dérivé de l'identifiant et d'un sel secret ; changer le sel invalide les anciens liens. */
export function guestToken(id: string, nonce: string): string {
  return `${id}.${hmacFor("support-guest", `${id}.${nonce}`).slice(0, 40)}`;
}
/** Le jeton est placé après « # » : il n’est jamais envoyé au serveur dans l’adresse, donc jamais journalisé. */
export const guestUrl = (origin: string, id: string, nonce: string) => `${origin}/assistance/suivi#${guestToken(id, nonce)}`;

interface Requester { id: string; userId: string | null; reference: string; subject: string; guestEmail?: string | null; guestName?: string | null; guestNonce?: string | null }

/** Informe le demandeur. Renvoie `true` si un e-mail est parti (visiteur sans compte). */
async function informRequester(r: Requester, n: { kind: "REQUEST_UPDATE" | "REQUEST_REPLY"; title: string; message?: string; origin: string }): Promise<boolean> {
  if (r.userId) {
    await notifyUser(r.userId, { kind: n.kind, title: n.title, body: r.subject, link: `/suggestions?demande=${r.id}`, refId: r.id });
    return false;
  }
  if (!r.guestEmail || !r.guestNonce) return false;
  const url = guestUrl(n.origin, r.id, r.guestNonce);
  const intro = n.message ? `L'équipe Niala a répondu à votre demande « ${r.subject} » :` : `Votre demande « ${r.subject} » a été mise à jour.`;
  return trySendEmail(
    {
      to: r.guestEmail,
      subject: `Niala — ${n.title}`,
      text: `Bonjour${r.guestName ? ` ${r.guestName}` : ""},\n\n${intro}\n\n${n.message ?? ""}\n\nPour lire tout l'échange et répondre : ${url}\n\nRéférence : ${r.reference}`,
      html: emailHtml({ title: n.title, paragraphs: [`Bonjour${r.guestName ? ` ${r.guestName}` : ""},`, intro, ...(n.message ? [n.message] : [])], button: { label: "Voir l'échange et répondre", url }, footer: `Référence ${r.reference}. Ce lien est personnel : ne le transmettez pas.` }),
    },
    `demande ${r.reference}`
  );
}

export const guestRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(320),
  name: z.string().trim().max(80).optional().transform((v) => v || undefined),
  subject: requestInputSchema.shape.subject,
  description: requestInputSchema.shape.description,
  /** Champ piège invisible : rempli uniquement par les robots. */
  website: z.string().max(200).optional(),
});

/** Demande d'assistance d'un visiteur sans compte (page de connexion). Le lien de suivi est envoyé par e-mail et affiché. */
export async function submitGuestRequest(raw: unknown, origin: string) {
  const input = guestRequestSchema.parse(raw);
  if (input.website) throw new ApiHttpError("Demande refusée.", 422);
  const recent = await db.supportRequest.count({ where: { guestEmail: input.email, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } } });
  if (recent >= 3) throw new ApiHttpError("Vous avez déjà envoyé plusieurs demandes aujourd'hui. Utilisez le lien de suivi reçu par e-mail pour compléter votre demande.", 429);
  const nonce = randomBytes(16).toString("hex");
  let created: { id: string; reference: string } | null = null;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    try {
      const reference = await nextReference();
      created = await db.supportRequest.create({
        data: { reference: attempt ? `${reference}-${randomBytes(2).toString("hex")}` : reference, userId: null, guestEmail: input.email, guestName: input.name ?? null, guestNonce: nonce, type: "ASSISTANCE", subject: input.subject, description: input.description, module: null, status: "RECEIVED", priority: "NORMAL" },
        select: { id: true, reference: true },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    }
  }
  if (!created) throw new ApiHttpError("Impossible d'enregistrer la demande pour le moment. Réessayez.", 503);
  const url = guestUrl(origin, created.id, nonce);
  const emailed = await trySendEmail(
    {
      to: input.email,
      subject: `Niala — demande ${created.reference} reçue`,
      text: `Bonjour${input.name ? ` ${input.name}` : ""},\n\nNous avons bien reçu votre demande « ${input.subject} ». L'équipe vous répondra par e-mail.\n\nSuivre ou compléter votre demande : ${url}\n\nRéférence : ${created.reference}`,
      html: emailHtml({ title: "Demande reçue", paragraphs: [`Bonjour${input.name ? ` ${input.name}` : ""},`, `Nous avons bien reçu votre demande « ${input.subject} ». L'équipe vous répondra par e-mail.`], button: { label: "Suivre ma demande", url }, footer: `Référence ${created.reference}. Ce lien est personnel : ne le transmettez pas.` }),
    },
    `demande ${created.reference}`
  );
  return { reference: created.reference, url, emailed };
}

/** Retrouve la demande d'un visiteur à partir de son lien de suivi (comparaison à temps constant). */
async function guestRequest(token: string) {
  const id = token.split(".")[0] ?? "";
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new ApiHttpError("Lien de suivi invalide ou expiré.", 404);
  const r = await db.supportRequest.findFirst({ where: { id, userId: null }, select: { id: true, reference: true, subject: true, description: true, status: true, createdAt: true, guestNonce: true, guestName: true } });
  const expected = r?.guestNonce ? Buffer.from(guestToken(r.id, r.guestNonce)) : Buffer.alloc(0);
  const given = Buffer.from(token);
  if (!r || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ApiHttpError("Lien de suivi invalide ou expiré.", 404);
  return r;
}

/** Échange visible par le visiteur (jamais les notes internes). */
export async function getGuestThread(token: string) {
  const r = await guestRequest(token);
  const messages = await db.supportMessage.findMany({ ...messageForUser, where: { requestId: r.id, internal: false } });
  return { reference: r.reference, subject: r.subject, description: r.description, status: r.status, statusLabel: REQUEST_STATUSES[r.status as RequestStatus] ?? r.status, createdAt: r.createdAt, closed: CLOSED_STATUSES.includes(r.status as RequestStatus), name: r.guestName, messages };
}

export async function replyAsGuest(token: string, bodyRaw: unknown) {
  const r = await guestRequest(token);
  const body = z.string().trim().min(2, "Écrivez votre message.").max(4000, "Message trop long.").parse(bodyRaw);
  if (CLOSED_STATUSES.includes(r.status as RequestStatus)) throw new ApiHttpError("Cette demande est clôturée. Envoyez une nouvelle demande depuis la page de connexion si besoin.", 409);
  await db.$transaction([
    db.supportMessage.create({ data: { requestId: r.id, authorId: null, authorRole: "USER", authorName: r.guestName, body } }),
    db.supportRequest.update({ where: { id: r.id }, data: r.status === "NEEDS_INFO" ? { status: "PENDING_REVIEW" } : { updatedAt: new Date() } }),
  ]);
  return { ok: true };
}

/** Nouveau lien de suivi pour un visiteur (l'ancien cesse de fonctionner) ; renvoyé à l'équipe et envoyé par e-mail si possible. */
export async function renewGuestLink(admin: AdminUser, id: string, origin = defaultOrigin()) {
  const r = await db.supportRequest.findUnique({ where: { id }, select: { userId: true, reference: true, subject: true, guestEmail: true, guestName: true } });
  if (!r) throw new ApiHttpError("Demande introuvable.", 404);
  if (r.userId || !r.guestEmail) throw new ApiHttpError("Cette demande provient d'un compte Niala : elle se suit depuis l'espace de l'étudiant.", 409);
  const nonce = randomBytes(16).toString("hex");
  await db.supportRequest.update({ where: { id }, data: { guestNonce: nonce } });
  const url = guestUrl(origin, id, nonce);
  const emailed = await trySendEmail({ to: r.guestEmail, subject: `Niala — votre lien de suivi (${r.reference})`, text: `Bonjour,\n\nVoici votre nouveau lien pour suivre la demande « ${r.subject} » : ${url}`, html: emailHtml({ title: "Votre lien de suivi", paragraphs: [`Voici votre nouveau lien pour suivre la demande « ${r.subject} ».`], button: { label: "Suivre ma demande", url }, footer: `Référence ${r.reference}.` }) }, `lien ${r.reference}`);
  await audit(admin, "request.guest_link", { targetType: "request", targetId: id, detail: { reference: r.reference, emailed } });
  return { url, emailed };
}

// ── Feuille de route ─────────────────────────────────────────────────────────

const ROADMAP_KEYS = Object.keys(ROADMAP_STATUSES) as [keyof typeof ROADMAP_STATUSES, ...(keyof typeof ROADMAP_STATUSES)[]];

export const roadmapCreateSchema = z.object({ title: z.string().trim().min(3, "Donnez un titre.").max(120), description: z.string().trim().max(1000).optional(), status: z.enum(ROADMAP_KEYS).default("TO_STUDY"), requestIds: z.array(z.string().max(40)).max(50).default([]) });

/** Crée un élément de feuille de route à partir d'une ou plusieurs demandes (regroupement des besoins similaires). */
export async function createRoadmapItem(admin: AdminUser, raw: unknown) {
  const input = roadmapCreateSchema.parse(raw);
  const item = await db.roadmapItem.create({ data: { title: input.title, description: input.description ?? null, status: input.status, createdById: admin.id } });
  if (input.requestIds.length) await db.supportRequest.updateMany({ where: { id: { in: input.requestIds } }, data: { roadmapItemId: item.id } });
  await audit(admin, "request.group", { targetType: "roadmap", targetId: item.id, detail: { title: item.title, requests: input.requestIds.length } });
  return { id: item.id };
}

export async function attachToRoadmap(admin: AdminUser, itemId: string, requestIds: string[]) {
  const item = await db.roadmapItem.findUnique({ where: { id: itemId }, select: { title: true } });
  if (!item) throw new ApiHttpError("Élément de feuille de route introuvable.", 404);
  const r = await db.supportRequest.updateMany({ where: { id: { in: requestIds.slice(0, 50) } }, data: { roadmapItemId: itemId } });
  await audit(admin, "request.group", { targetType: "roadmap", targetId: itemId, detail: { title: item.title, requests: r.count } });
  return { ok: true, count: r.count };
}

export async function detachFromRoadmap(admin: AdminUser, requestId: string) {
  await db.supportRequest.update({ where: { id: requestId }, data: { roadmapItemId: null } });
  await audit(admin, "request.group", { targetType: "request", targetId: requestId, detail: { detached: true } });
  return { ok: true };
}

export const roadmapUpdateSchema = z.object({ status: z.enum(ROADMAP_KEYS).optional(), title: z.string().trim().min(3).max(120).optional(), description: z.string().trim().max(1000).nullable().optional() });

export async function updateRoadmapItem(admin: AdminUser, id: string, raw: unknown) {
  const input = roadmapUpdateSchema.parse(raw);
  const before = await db.roadmapItem.findUnique({ where: { id }, include: { requests: { select: { userId: true, reference: true } } } });
  if (!before) throw new ApiHttpError("Élément de feuille de route introuvable.", 404);
  await db.roadmapItem.update({ where: { id }, data: input });
  if (input.status === "DEPLOYED" && before.status !== "DEPLOYED") {
    const users = [...new Set(before.requests.map((r) => r.userId).filter((u): u is string => !!u))];
    for (const userId of users) await notifyUser(userId, { kind: "REQUEST_UPDATE", title: "Une amélioration que vous aviez suggérée est disponible", body: before.title, link: "/suggestions", refId: id });
  }
  await audit(admin, "roadmap.update", { targetType: "roadmap", targetId: id, detail: { title: before.title, ...(input.status && input.status !== before.status ? { status: [before.status, input.status] } : {}) } });
  return { ok: true };
}

export async function listRoadmap() {
  const items = await db.roadmapItem.findMany({ orderBy: { updatedAt: "desc" }, take: 100, include: { _count: { select: { requests: true } } } });
  return items.map((i) => ({ id: i.id, title: i.title, description: i.description, status: i.status, requests: i._count.requests, updatedAt: i.updatedAt }));
}

// ── Analyse des demandes ─────────────────────────────────────────────────────

export function getRequestAnalytics(p: Period) {
  return cached(`requests:${periodKey(p)}`, async () => {
    const [byType, byModule, byStatus, series, times, top, total, prevTotal] = await Promise.all([
      db.$queryRaw<{ k: string; v: bigint }[]>`SELECT type AS k, count(*) AS v FROM "SupportRequest" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
      db.$queryRaw<{ k: string | null; v: bigint; bugs: bigint }[]>`SELECT module AS k, count(*) AS v, count(*) FILTER (WHERE type IN ('BUG','AI_ISSUE','EXERCISE_DIFFICULTY')) AS bugs FROM "SupportRequest" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 2 DESC`,
      db.$queryRaw<{ k: string; v: bigint }[]>`SELECT status AS k, count(*) AS v FROM "SupportRequest" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1`,
      db.$queryRaw<{ bucket: Date; v: bigint }[]>`SELECT ${bucketSql(p.bucket)} AS bucket, count(*) AS v FROM "SupportRequest" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to} GROUP BY 1 ORDER BY 1`,
      db.$queryRaw<{ resolve_h: number | null; reply_h: number | null; resolved: bigint }[]>`
        SELECT avg(extract(epoch FROM ("closedAt" - "createdAt")) / 3600.0) FILTER (WHERE "closedAt" IS NOT NULL) AS resolve_h,
               avg(extract(epoch FROM ("firstReplyAt" - "createdAt")) / 3600.0) FILTER (WHERE "firstReplyAt" IS NOT NULL) AS reply_h,
               count(*) FILTER (WHERE "closedAt" IS NOT NULL) AS resolved
        FROM "SupportRequest" WHERE "createdAt" >= ${p.from} AND "createdAt" <= ${p.to}`,
      db.$queryRaw<{ id: string; title: string; status: string; v: bigint; users: bigint }[]>`
        SELECT i.id, i.title, i.status, count(r.id) AS v, count(DISTINCT r."userId") AS users FROM "RoadmapItem" i JOIN "SupportRequest" r ON r."roadmapItemId" = i.id GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 8`,
      db.supportRequest.count({ where: { createdAt: { gte: p.from, lte: p.to } } }),
      db.supportRequest.count({ where: { createdAt: { gte: p.prevFrom, lte: p.prevTo } } }),
    ]);
    return {
      total,
      previous: prevTotal,
      change: prevTotal > 0 ? round1(((total - prevTotal) / prevTotal) * 100) : null,
      byType: byType.map((r) => ({ key: r.k, label: REQUEST_TYPES[r.k as keyof typeof REQUEST_TYPES] ?? r.k, value: n(r.v) })),
      byModule: byModule.map((r) => ({ key: r.k ?? "other", label: r.k ? (MODULES[r.k as keyof typeof MODULES] ?? r.k) : "Non précisé", value: n(r.v), problems: n(r.bugs) })),
      byStatus: byStatus.map((r) => ({ key: r.k, label: REQUEST_STATUSES[r.k as RequestStatus] ?? r.k, value: n(r.v) })),
      series: fillSeries(series.map((r) => ({ bucket: r.bucket, value: n(r.v) })), p, (bucket) => ({ bucket, value: 0 })),
      avgResolutionHours: times[0]?.resolve_h == null ? null : round1(Number(times[0].resolve_h)),
      avgFirstReplyHours: times[0]?.reply_h == null ? null : round1(Number(times[0].reply_h)),
      resolvedCount: n(times[0]?.resolved),
      resolutionRate: ratio(n(times[0]?.resolved), total),
      recurring: top.map((t) => ({ id: t.id, title: t.title, status: t.status, requests: n(t.v), users: n(t.users) })),
    };
  });
}
