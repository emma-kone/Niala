import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { audit } from "@/server/admin/audit";
import { publishAnnouncement, ANNOUNCEMENT_KINDS } from "@/server/admin/comms";
import { ADMIN_ROLES, ROLE_LABELS, type Permission } from "@/server/admin/rbac";
import type { AdminUser } from "@/server/admin/session";
import { SETTING_DEFS, setAdminRole, updateSetting, type SettingKey } from "@/server/admin/settings";
import { clearStatsCache } from "@/server/admin/stats/common";
import { resolveAlert } from "@/server/admin/stats/tech";
import { addInternalNote, attachToRoadmap, createRoadmapItem, detachFromRoadmap, replyToRequest, updateRequest, updateRoadmapItem } from "@/server/admin/support";
import { createResetLinkFor, deleteUserAccount, setAccountStatus, updateAdminInfo } from "@/server/admin/users";
import { PRIORITIES, REQUEST_STATUSES, ROADMAP_STATUSES } from "@/server/analytics/definitions";
import type { ToolDeclaration } from "@/server/ai/provider";

// ─────────────────────────────────────────────────────────────────────────────
// Actions que l'assistant IA peut PROPOSER. Aucune n'est exécutée par le modèle : il ne fait que préparer une
// proposition ; l'administrateur la confirme d'un clic et l'exécution passe alors par les MÊMES fonctions métier que
// les boutons du back-office (mêmes contrôles, mêmes garde-fous, même journal d'audit), après revérification de la
// permission en base.
// Le résumé affiché à l'administrateur contient les vraies identités ; il n'est jamais renvoyé au modèle.
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionSummary {
  title: string;
  lines: string[];
  /** Action irréversible ou à fort impact : affichée en rouge. */
  danger?: boolean;
  /** Texte que l'administrateur doit recopier pour confirmer (ex. l'adresse d'un compte à supprimer). */
  typeToConfirm?: string;
}

export interface ActionResult {
  message: string;
  /** Lien à transmettre (réinitialisation de mot de passe) : affiché à l'administrateur seulement. */
  link?: string;
}

interface ActionDef<S extends z.ZodTypeAny> {
  permission: Permission;
  description: string;
  parameters: ToolDeclaration["parameters"];
  schema: S;
  summarize: (admin: AdminUser, args: z.infer<S>) => Promise<ActionSummary>;
  run: (admin: AdminUser, args: z.infer<S>, ctx: { origin: string; typed?: string }) => Promise<ActionResult>;
}

const define = <S extends z.ZodTypeAny>(d: ActionDef<S>) => d;

/** Paramètre « liste » transmis par le modèle sous forme de texte séparé par des virgules. */
const csv = z
  .string()
  .max(4000)
  .optional()
  .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []));
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));
const keysOf = <T extends Record<string, string>>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];
const list = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k} (${v})`).join(", ");

async function userLabel(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: { email: true, name: true, adminRole: true, accountStatus: true } });
  if (!u) throw new ApiHttpError("Utilisateur introuvable : vérifiez l'identifiant.", 404);
  return { ...u, text: `${u.name ?? "Sans nom"} (${u.email})` };
}

async function requestLabel(id: string) {
  const r = await db.supportRequest.findUnique({ where: { id }, select: { reference: true, subject: true, status: true } });
  if (!r) throw new ApiHttpError("Demande introuvable : vérifiez l'identifiant.", 404);
  return { ...r, text: `${r.reference} — ${r.subject}` };
}

async function roadmapLabel(id: string) {
  const i = await db.roadmapItem.findUnique({ where: { id }, select: { title: true, status: true } });
  if (!i) throw new ApiHttpError("Élément de feuille de route introuvable.", 404);
  return i;
}

const STATUS_FR = { ACTIVE: "Réactiver", SUSPENDED: "Suspendre", DISABLED: "Désactiver" } as const;

export const ACTIONS = {
  set_user_status: define({
    permission: "users.manage",
    description: "Propose de suspendre, désactiver ou réactiver un compte étudiant. Un motif est obligatoire pour suspendre ou désactiver. Suspendre ou désactiver déconnecte immédiatement l'étudiant.",
    parameters: { type: "OBJECT", properties: { userId: { type: "STRING", description: "Identifiant du compte (champ id)." }, status: { type: "STRING", description: "ACTIVE, SUSPENDED ou DISABLED." }, reason: { type: "STRING", description: "Motif (visible uniquement par l'administration)." } }, required: ["userId", "status"] },
    schema: z.object({ userId: z.string().min(1).max(40), status: z.enum(["ACTIVE", "SUSPENDED", "DISABLED"]), reason: opt(300) }),
    async summarize(_a, { userId, status, reason }) {
      const u = await userLabel(userId);
      if (u.adminRole) throw new ApiHttpError("Les comptes d'administration se gèrent depuis les paramètres d'administration.", 403);
      if (u.accountStatus === status) throw new ApiHttpError("Le compte est déjà dans cet état.", 409);
      if (status !== "ACTIVE" && !reason) throw new ApiHttpError("Un motif est obligatoire pour suspendre ou désactiver : demande-le à l'administrateur.", 422);
      return { title: `${STATUS_FR[status]} le compte de ${u.text}`, lines: [`Statut actuel : ${u.accountStatus}`, ...(reason ? [`Motif : ${reason}`] : []), ...(status !== "ACTIVE" ? ["L'étudiant sera déconnecté immédiatement."] : [])], danger: status === "DISABLED" };
    },
    async run(admin, { userId, status, reason }) {
      await setAccountStatus(admin, userId, { status, reason });
      return { message: `Compte ${status === "ACTIVE" ? "réactivé" : status === "SUSPENDED" ? "suspendu" : "désactivé"}.` };
    },
  }),

  update_user_info: define({
    permission: "users.manage",
    description: "Propose de corriger les renseignements administratifs d'un compte : nom, établissement, filière, catégorie (jamais l'e-mail ni le mot de passe).",
    parameters: { type: "OBJECT", properties: { userId: { type: "STRING" }, name: { type: "STRING" }, institution: { type: "STRING" }, field: { type: "STRING" }, category: { type: "STRING", description: "ESATIC, OTHER_SCHOOL ou TESTER." } }, required: ["userId"] },
    schema: z.object({ userId: z.string().min(1).max(40), name: opt(80), institution: opt(120), field: opt(120), category: z.enum(["ESATIC", "OTHER_SCHOOL", "TESTER"]).optional() }),
    async summarize(_a, { userId, ...changes }) {
      const u = await userLabel(userId);
      const lines = Object.entries(changes).filter(([, v]) => v !== undefined).map(([k, v]) => `${{ name: "Nom", institution: "Établissement", field: "Filière", category: "Catégorie" }[k] ?? k} → ${v}`);
      if (!lines.length) throw new ApiHttpError("Aucune modification indiquée.", 422);
      return { title: `Modifier les renseignements de ${u.text}`, lines };
    },
    async run(admin, { userId, ...changes }) {
      await updateAdminInfo(admin, userId, changes);
      return { message: "Renseignements mis à jour." };
    },
  }),

  delete_user: define({
    permission: "users.delete",
    description: "Propose de SUPPRIMER un compte étudiant (irréversible) : son identité et ses fichiers d'origine sont effacés, son activité reste dans les statistiques sous forme anonyme. Suggère d'abord la suspension si un retour en arrière peut être utile.",
    parameters: { type: "OBJECT", properties: { userId: { type: "STRING" } }, required: ["userId"] },
    schema: z.object({ userId: z.string().min(1).max(40) }),
    async summarize(_a, { userId }) {
      const u = await userLabel(userId);
      if (u.adminRole) throw new ApiHttpError("Les comptes d'administration se gèrent depuis les paramètres d'administration.", 403);
      if (u.accountStatus === "DELETED") throw new ApiHttpError("Ce compte a déjà été supprimé.", 409);
      return { title: `Supprimer le compte de ${u.text}`, lines: ["Nom, adresse e-mail, mot de passe, photo et fichiers d'origine seront effacés ; la connexion deviendra impossible.", "Son activité (contenus, exercices, résultats) reste en base sous forme anonyme pour les statistiques.", "Cette action est irréversible."], danger: true, typeToConfirm: u.email };
    },
    async run(admin, { userId }, { typed }) {
      await deleteUserAccount(admin, userId, { confirmEmail: typed ?? "" });
      return { message: "Compte supprimé et anonymisé." };
    },
  }),

  create_reset_link: define({
    permission: "users.manage",
    description: "Propose de créer un lien de réinitialisation du mot de passe (valable 24 h, usage unique) que l'administrateur transmettra à l'étudiant. Le lien n'est jamais montré à l'IA.",
    parameters: { type: "OBJECT", properties: { userId: { type: "STRING" } }, required: ["userId"] },
    schema: z.object({ userId: z.string().min(1).max(40) }),
    async summarize(_a, { userId }) {
      const u = await userLabel(userId);
      return { title: `Créer un lien de réinitialisation pour ${u.text}`, lines: ["Lien valable 24 heures, utilisable une seule fois."] };
    },
    async run(admin, { userId }, { origin }) {
      const { url } = await createResetLinkFor(admin, userId, origin);
      return { message: "Lien créé, valable 24 heures : transmettez-le à l'étudiant.", link: url };
    },
  }),

  update_request: define({
    permission: "support.manage",
    description: `Propose de changer le statut, la priorité ou la personne assignée d'une demande. Statuts : ${list(REQUEST_STATUSES)}. Priorités : ${list(PRIORITIES)}. assigneeId : identifiant d'un administrateur, ou "none" pour retirer l'assignation.`,
    parameters: { type: "OBJECT", properties: { requestId: { type: "STRING" }, status: { type: "STRING" }, priority: { type: "STRING" }, assigneeId: { type: "STRING" } }, required: ["requestId"] },
    schema: z.object({ requestId: z.string().min(1).max(40), status: z.enum(keysOf(REQUEST_STATUSES)).optional(), priority: z.enum(keysOf(PRIORITIES)).optional(), assigneeId: opt(40) }),
    async summarize(_a, { requestId, status, priority, assigneeId }) {
      const r = await requestLabel(requestId);
      const lines: string[] = [];
      if (status) lines.push(`Statut : ${REQUEST_STATUSES[r.status as keyof typeof REQUEST_STATUSES] ?? r.status} → ${REQUEST_STATUSES[status]}${status !== r.status ? " (l'étudiant est notifié)" : ""}`);
      if (priority) lines.push(`Priorité → ${PRIORITIES[priority]}`);
      if (assigneeId) lines.push(assigneeId === "none" ? "Retirer l'assignation" : `Assigner à ${(await userLabel(assigneeId)).text}`);
      if (!lines.length) throw new ApiHttpError("Aucune modification indiquée.", 422);
      return { title: `Modifier la demande ${r.text}`, lines };
    },
    async run(admin, { requestId, status, priority, assigneeId }) {
      await updateRequest(admin, requestId, { status, priority, ...(assigneeId ? { assigneeId: assigneeId === "none" ? null : assigneeId } : {}) });
      return { message: "Demande mise à jour." };
    },
  }),

  reply_request: define({
    permission: "support.manage",
    description: "Propose une réponse VISIBLE PAR L'ÉTUDIANT à une demande (il reçoit une notification). Rédige un message poli, clair, signé implicitement « Équipe Niala ». Optionnel : nouveau statut.",
    parameters: { type: "OBJECT", properties: { requestId: { type: "STRING" }, body: { type: "STRING", description: "Texte de la réponse (2 à 4000 caractères)." }, status: { type: "STRING" } }, required: ["requestId", "body"] },
    schema: z.object({ requestId: z.string().min(1).max(40), body: z.string().trim().min(2).max(4000), status: z.enum(keysOf(REQUEST_STATUSES)).optional() }),
    async summarize(_a, { requestId, body, status }) {
      const r = await requestLabel(requestId);
      return { title: `Répondre à la demande ${r.text}`, lines: [`Message envoyé à l'étudiant :\n${body}`, ...(status ? [`Nouveau statut : ${REQUEST_STATUSES[status]}`] : [])] };
    },
    async run(admin, { requestId, body, status }) {
      await replyToRequest(admin, requestId, { body, status });
      return { message: "Réponse envoyée à l'étudiant." };
    },
  }),

  add_request_note: define({
    permission: "support.manage",
    description: "Propose d'ajouter une note INTERNE (jamais visible par l'étudiant) à une demande.",
    parameters: { type: "OBJECT", properties: { requestId: { type: "STRING" }, body: { type: "STRING" } }, required: ["requestId", "body"] },
    schema: z.object({ requestId: z.string().min(1).max(40), body: z.string().trim().min(2).max(4000) }),
    async summarize(_a, { requestId, body }) {
      const r = await requestLabel(requestId);
      return { title: `Ajouter une note interne à ${r.text}`, lines: [body] };
    },
    async run(admin, { requestId, body }) {
      await addInternalNote(admin, requestId, body);
      return { message: "Note interne ajoutée." };
    },
  }),

  create_roadmap_item: define({
    permission: "support.manage",
    description: `Propose de créer un élément de feuille de route, éventuellement en y regroupant des demandes similaires. Statuts : ${list(ROADMAP_STATUSES)}.`,
    parameters: { type: "OBJECT", properties: { title: { type: "STRING" }, description: { type: "STRING" }, status: { type: "STRING" }, requestIds: { type: "STRING", description: "Identifiants de demandes séparés par des virgules." } }, required: ["title"] },
    schema: z.object({ title: z.string().trim().min(3).max(120), description: opt(1000), status: z.enum(keysOf(ROADMAP_STATUSES)).optional(), requestIds: csv }),
    async summarize(_a, { title, description, status, requestIds }) {
      const refs = requestIds.length ? await db.supportRequest.findMany({ where: { id: { in: requestIds } }, select: { reference: true } }) : [];
      return { title: `Créer l'élément de feuille de route « ${title} »`, lines: [...(description ? [description] : []), `Statut : ${ROADMAP_STATUSES[status ?? "TO_STUDY"]}`, ...(refs.length ? [`Demandes regroupées : ${refs.map((r) => r.reference).join(", ")}`] : [])] };
    },
    async run(admin, args) {
      await createRoadmapItem(admin, args);
      return { message: "Élément de feuille de route créé." };
    },
  }),

  attach_to_roadmap: define({
    permission: "support.manage",
    description: "Propose de rattacher des demandes à un élément existant de la feuille de route.",
    parameters: { type: "OBJECT", properties: { itemId: { type: "STRING" }, requestIds: { type: "STRING", description: "Identifiants séparés par des virgules." } }, required: ["itemId", "requestIds"] },
    schema: z.object({ itemId: z.string().min(1).max(40), requestIds: csv }),
    async summarize(_a, { itemId, requestIds }) {
      const item = await roadmapLabel(itemId);
      if (!requestIds.length) throw new ApiHttpError("Aucune demande indiquée.", 422);
      const refs = await db.supportRequest.findMany({ where: { id: { in: requestIds } }, select: { reference: true } });
      return { title: `Rattacher ${refs.length} demande(s) à « ${item.title} »`, lines: [refs.map((r) => r.reference).join(", ")] };
    },
    async run(admin, { itemId, requestIds }) {
      const r = await attachToRoadmap(admin, itemId, requestIds);
      return { message: `${r.count} demande(s) rattachée(s).` };
    },
  }),

  detach_from_roadmap: define({
    permission: "support.manage",
    description: "Propose de détacher une demande de son élément de feuille de route.",
    parameters: { type: "OBJECT", properties: { requestId: { type: "STRING" } }, required: ["requestId"] },
    schema: z.object({ requestId: z.string().min(1).max(40) }),
    async summarize(_a, { requestId }) {
      const r = await requestLabel(requestId);
      return { title: `Détacher la demande ${r.text} de la feuille de route`, lines: [] };
    },
    async run(admin, { requestId }) {
      await detachFromRoadmap(admin, requestId);
      return { message: "Demande détachée." };
    },
  }),

  update_roadmap_item: define({
    permission: "support.manage",
    description: `Propose de modifier un élément de feuille de route (statut, titre, description). Passer au statut DEPLOYED notifie les étudiants concernés. Statuts : ${list(ROADMAP_STATUSES)}.`,
    parameters: { type: "OBJECT", properties: { itemId: { type: "STRING" }, status: { type: "STRING" }, title: { type: "STRING" }, description: { type: "STRING" } }, required: ["itemId"] },
    schema: z.object({ itemId: z.string().min(1).max(40), status: z.enum(keysOf(ROADMAP_STATUSES)).optional(), title: z.string().trim().min(3).max(120).optional(), description: opt(1000) }),
    async summarize(_a, { itemId, status, title, description }) {
      const item = await roadmapLabel(itemId);
      const lines = [...(status ? [`Statut : ${ROADMAP_STATUSES[item.status as keyof typeof ROADMAP_STATUSES] ?? item.status} → ${ROADMAP_STATUSES[status]}${status === "DEPLOYED" && item.status !== "DEPLOYED" ? " (les étudiants concernés sont notifiés)" : ""}`] : []), ...(title ? [`Titre → ${title}`] : []), ...(description ? [`Description → ${description}`] : [])];
      if (!lines.length) throw new ApiHttpError("Aucune modification indiquée.", 422);
      return { title: `Modifier « ${item.title} »`, lines };
    },
    async run(admin, { itemId, ...changes }) {
      await updateRoadmapItem(admin, itemId, Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)));
      return { message: "Feuille de route mise à jour." };
    },
  }),

  update_setting: define({
    permission: "settings.manage",
    description: `Propose de modifier un paramètre global. Paramètres : ${Object.entries(SETTING_DEFS).map(([k, d]) => `${k} (${d.label}, ${typeof d.default === "boolean" ? "true/false" : "nombre entier"})`).join(" ; ")}.`,
    parameters: { type: "OBJECT", properties: { key: { type: "STRING" }, value: { type: "STRING", description: "Nouvelle valeur : nombre ou true/false." } }, required: ["key", "value"] },
    schema: z.object({ key: z.enum(Object.keys(SETTING_DEFS) as [SettingKey, ...SettingKey[]]), value: z.string().trim().max(20) }),
    async summarize(_a, { key, value }) {
      const def = SETTING_DEFS[key];
      const parsed = def.schema.safeParse(typeof def.default === "boolean" ? value === "true" ? true : value === "false" ? false : value : Number(value));
      if (!parsed.success) throw new ApiHttpError(`Valeur invalide pour ${key} : ${parsed.error.issues[0]?.message ?? ""}`, 422);
      return { title: `Modifier le paramètre « ${def.label} »`, lines: [`Nouvelle valeur : ${String(parsed.data)}`] };
    },
    async run(admin, { key, value }) {
      const def = SETTING_DEFS[key];
      await updateSetting(admin, key, typeof def.default === "boolean" ? value === "true" : Number(value));
      return { message: "Paramètre mis à jour." };
    },
  }),

  set_admin_role: define({
    permission: "admins.manage",
    description: `Propose d'attribuer, changer ou retirer un rôle d'administration. Rôles : ${ADMIN_ROLES.map((r) => `${r} (${ROLE_LABELS[r]})`).join(", ")}, ou NONE pour retirer le rôle. Désigne le compte par userId, ou par email si l'administrateur te l'a donné.`,
    parameters: { type: "OBJECT", properties: { userId: { type: "STRING" }, email: { type: "STRING" }, role: { type: "STRING" } }, required: ["role"] },
    schema: z.object({ userId: opt(40), email: opt(320), role: z.enum([...ADMIN_ROLES, "NONE"] as [string, ...string[]]) }),
    async summarize(_a, { userId, email, role }) {
      const u = userId ? await userLabel(userId) : email ? await db.user.findUnique({ where: { email: email.toLowerCase() }, select: { email: true, name: true, adminRole: true } }).then((x) => (x ? { ...x, text: `${x.name ?? "Sans nom"} (${x.email})` } : null)) : null;
      if (!u) throw new ApiHttpError("Compte introuvable : indique userId ou une adresse existante.", 404);
      return { title: role === "NONE" ? `Retirer le rôle d'administration de ${u.text}` : `Donner le rôle ${ROLE_LABELS[role as keyof typeof ROLE_LABELS]} à ${u.text}`, lines: [`Rôle actuel : ${u.adminRole ? ROLE_LABELS[u.adminRole as keyof typeof ROLE_LABELS] ?? u.adminRole : "aucun"}`], danger: true };
    },
    async run(admin, { userId, email, role }) {
      const target = email ?? (userId ? (await userLabel(userId)).email : "");
      await setAdminRole(admin, { email: target, role });
      return { message: "Rôle mis à jour." };
    },
  }),

  publish_announcement: define({
    permission: "comms.send",
    description: `Propose de diffuser une annonce aux étudiants : toujours dans Niala (cloche), et au choix par e-mail et en notification push sur leurs appareils (même site fermé). Types : ${list(ANNOUNCEMENT_KINDS)}. target : "all" = tous les utilisateurs actifs, "targeted" = selon catégories (ESATIC, OTHER_SCHOOL, TESTER) et/ou établissements, séparés par des virgules.`,
    parameters: { type: "OBJECT", properties: { kind: { type: "STRING" }, title: { type: "STRING", description: "3 à 100 caractères." }, body: { type: "STRING", description: "5 à 1000 caractères." }, target: { type: "STRING", description: "all ou targeted." }, categories: { type: "STRING" }, institutions: { type: "STRING" }, email: { type: "STRING", description: "true pour envoyer aussi par e-mail." }, push: { type: "STRING", description: "true pour envoyer aussi en notification push." } }, required: ["kind", "title", "body", "target"] },
    schema: z.object({ kind: z.enum(keysOf(ANNOUNCEMENT_KINDS)), title: z.string().trim().min(3).max(100), body: z.string().trim().min(5).max(1000), target: z.enum(["all", "targeted"]), categories: csv, institutions: csv, email: z.string().optional().transform((v) => v === "true"), push: z.string().optional().transform((v) => v === "true") }),
    async summarize(_a, { kind, title, body, target, categories, institutions, email, push }) {
      const { previewAnnouncement } = await import("@/server/admin/comms");
      const audience = { ...(categories.length ? { categories } : {}), ...(institutions.length ? { institutions } : {}) };
      const p = await previewAnnouncement({ kind, title, body, target, audience, channels: { email, push } });
      if (!p.recipients) throw new ApiHttpError("Aucun destinataire ne correspond à ces critères.", 422);
      if (p.remainingToday <= 0) throw new ApiHttpError(`Plafond atteint : ${p.dailyLimit} annonce(s) par 24 heures.`, 429);
      const channels = ["dans Niala", ...(email ? [p.email.configured ? `par e-mail (${p.email.reachable})` : "par e-mail (non configuré : ne partira pas)"] : []), ...(push ? [p.push.configured ? `en push (${p.push.reachable} avec un appareil)` : "en push (non configuré)"] : [])];
      return { title: `Diffuser l'annonce « ${title} »`, lines: [`Type : ${p.kindLabel}`, `Destinataires : ${target === "all" ? "tous les utilisateurs actifs" : "audience ciblée"} (${p.recipients})`, `Canaux : ${channels.join(", ")}`, `Message :
${body}`, `Annonces encore possibles aujourd'hui : ${p.remainingToday}`], danger: true };
    },
    async run(admin, { kind, title, body, target, categories, institutions, email, push }, { origin }) {
      const { deliverAnnouncement } = await import("@/server/admin/comms");
      const r = await publishAnnouncement(admin, { confirm: true, kind, title, body, target, audience: { ...(categories.length ? { categories } : {}), ...(institutions.length ? { institutions } : {}) }, channels: { email, push } });
      if (email || push) void deliverAnnouncement(r.id, origin).catch((e) => console.error("[annonce] envoi hors site :", e instanceof Error ? e.message : e));
      return { message: `Annonce diffusée à ${r.recipients} étudiant(s)${email || push ? " ; envois e-mail/push en cours" : ""}.` };
    },
  }),

  resolve_alert: define({
    permission: "tech.view",
    description: "Propose de marquer une alerte de supervision comme résolue.",
    parameters: { type: "OBJECT", properties: { alertId: { type: "STRING" } }, required: ["alertId"] },
    schema: z.object({ alertId: z.string().min(1).max(40) }),
    async summarize(_a, { alertId }) {
      const a = await db.adminAlert.findUnique({ where: { id: alertId }, select: { title: true, status: true } });
      if (!a) throw new ApiHttpError("Alerte introuvable.", 404);
      if (a.status !== "OPEN") throw new ApiHttpError("Cette alerte est déjà résolue.", 409);
      return { title: `Marquer l'alerte « ${a.title} » comme résolue`, lines: [] };
    },
    async run(admin, { alertId }) {
      await resolveAlert(admin, alertId);
      return { message: "Alerte résolue." };
    },
  }),

  run_backfill: define({
    permission: "data.backfill",
    description: "Propose de reconstituer l'historique d'événements à partir des tables d'origine (rejouable sans doublon ; peut prendre du temps).",
    parameters: { type: "OBJECT", properties: {} },
    schema: z.object({}),
    async summarize() {
      return { title: "Reconstituer l'historique des événements", lines: ["Opération rejouable sans doublon, qui peut prendre plusieurs secondes."] };
    },
    async run(admin) {
      const { backfillAnalytics } = await import("@/server/analytics/backfill");
      const results = await backfillAnalytics();
      clearStatsCache();
      await audit(admin, "data.backfill", { targetType: "analytics", detail: { inserted: Object.fromEntries(results.map((r) => [r.type, r.inserted])) } });
      return { message: `Historique reconstitué (${results.reduce((s, r) => s + r.inserted, 0)} événement(s) ajouté(s)).` };
    },
  }),
} satisfies Record<string, ActionDef<z.ZodTypeAny>>;

export type ActionName = keyof typeof ACTIONS;
export const isActionName = (v: string): v is ActionName => v in ACTIONS;
