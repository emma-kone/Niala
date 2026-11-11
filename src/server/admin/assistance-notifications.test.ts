// Assistance sans compte, suppression et clôture groupée des demandes, annonces (tous les actifs, canaux, suppression, désinscription).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let rbac: typeof import("@/server/admin/rbac");
let support: typeof import("@/server/admin/support");
let comms: typeof import("@/server/admin/comms");
let lib: typeof import("@/lib/db");
type AdminUserT = import("@/server/admin/session").AdminUser;
let root: AdminUserT;
let student: string;
const sent: { url: string; body: unknown }[] = [];

beforeAll(async () => {
  ctx = await startTestDb();
  lib = await import("@/lib/db");
  rbac = await import("@/server/admin/rbac");
  support = await import("@/server/admin/support");
  comms = await import("@/server/admin/comms");
  const u = await ctx.db.user.create({ data: { email: "root@niala.test", name: "Root", passwordHash: "x", adminRole: "SUPER_ADMIN" } });
  root = { id: u.id, email: u.email, name: u.name, role: "SUPER_ADMIN", permissions: rbac.permissionsOf("SUPER_ADMIN") };
  student = (await ctx.db.user.create({ data: { email: "etu@niala.test", name: "Étudiante", passwordHash: "x", profile: { create: { category: "ESATIC", institution: "ESATIC" } } } })).id;
  await ctx.db.user.create({ data: { email: "autre@niala.test", passwordHash: "x", profile: { create: { category: "TESTER" } }, settings: { create: { emailAnnouncements: false } } } });
  // E-mails simulés : l'appel à Resend est intercepté.
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Niala <equipe@niala.test>";
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    sent.push({ url, body: JSON.parse(init.body) });
    return new Response("{}", { status: 200 });
  });
}, 90_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  await ctx?.stop();
});

describe("assistance sans compte", () => {
  let token = "";
  let id = "";

  it("enregistre la demande, envoie un e-mail de confirmation avec un lien de suivi dans le fragment", async () => {
    sent.length = 0;
    const r = await support.submitGuestRequest({ email: "Visiteur@Exemple.fr", name: "Awa", subject: "Connexion impossible", description: "Je n'arrive pas à créer mon compte depuis ce matin." }, "https://niala.test");
    expect(r.reference).toMatch(/^NL-/);
    expect(r.emailed).toBe(true);
    expect(r.url).toMatch(/^https:\/\/niala\.test\/assistance\/suivi#/);
    token = r.url.split("#")[1];
    id = token.split(".")[0];
    const row = await ctx.db.supportRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ userId: null, guestEmail: "visiteur@exemple.fr", guestName: "Awa", type: "ASSISTANCE" });
    expect(JSON.stringify(sent[0].body)).toContain(r.url);
  });

  it("refuse les robots (champ piège) et un lien falsifié", async () => {
    await expect(support.submitGuestRequest({ email: "bot@x.fr", subject: "Promo", description: "Achetez maintenant !!!", website: "spam.example" }, "x")).rejects.toMatchObject({ status: 422 });
    await expect(support.getGuestThread(`${id}.faux${"0".repeat(36)}`)).rejects.toMatchObject({ status: 404 });
  });

  it("la réponse de l'équipe part par e-mail avec le lien ; le visiteur répond depuis son lien, sans compte", async () => {
    sent.length = 0;
    const r = await support.replyToRequest(root, id, { body: "Bonjour, essayez avec un autre navigateur." }, "https://niala.test");
    expect(r).toMatchObject({ guest: true, emailed: true });
    expect(JSON.stringify(sent[0].body)).toContain("essayez avec un autre navigateur");
    expect(JSON.stringify(sent[0].body)).toContain(token);
    await support.replyAsGuest(token, "Merci, cela fonctionne !");
    const thread = await support.getGuestThread(token);
    expect(thread.messages.map((m) => m.authorRole)).toEqual(["ADMIN", "USER"]);
    // La demande apparaît dans la liste du back-office, signalée « sans compte ».
    const list = await support.listRequests({});
    expect(list.rows.find((x) => x.id === id)).toMatchObject({ guest: true, userEmail: "visiteur@exemple.fr", description: expect.stringContaining("créer mon compte") });
  });

  it("un nouveau lien de suivi invalide l'ancien", async () => {
    const { url } = await support.renewGuestLink(root, id, "https://niala.test");
    await expect(support.getGuestThread(token)).rejects.toMatchObject({ status: 404 });
    token = url.split("#")[1];
    expect((await support.getGuestThread(token)).reference).toMatch(/^NL-/);
  });
});

describe("suppression et clôture groupée", () => {
  it("clôture une sélection, puis la supprime : masquée partout, conservée pour les statistiques", async () => {
    const a = await support.submitRequest(student, { type: "BUG", subject: "Bug A", description: "Premier problème signalé." });
    const b = await support.submitRequest(student, { type: "BUG", subject: "Bug B", description: "Deuxième problème signalé." });
    const r = await support.bulkUpdateStatus(root, { ids: [a.id, b.id], status: "RESOLVED" });
    expect(r.updated).toBe(2);
    expect(await ctx.db.supportRequest.count({ where: { id: { in: [a.id, b.id] }, status: "RESOLVED", closedAt: { not: null } } })).toBe(2);
    expect(await ctx.db.userNotification.count({ where: { userId: student, kind: "REQUEST_UPDATE" } })).toBe(2);

    await support.deleteRequests(root, { ids: [a.id, b.id] });
    expect((await support.listRequests({})).rows.some((x) => x.id === a.id)).toBe(false);
    expect((await support.listMyRequests(student)).some((x) => x.id === a.id)).toBe(false);
    expect(await lib.dbAll.supportRequest.count({ where: { id: { in: [a.id, b.id] }, deletedAt: { not: null } } })).toBe(2);
    expect(await ctx.db.adminAuditLog.count({ where: { action: "request.delete" } })).toBe(2);
  });
});

describe("annonces", () => {
  it("à tous les actifs, par e-mail (sauf désinscrits) ; supprimée, elle disparaît des notifications", async () => {
    const preview = await comms.previewAnnouncement({ kind: "INFO", title: "Maintenance", body: "Coupure ce soir.", target: "all", channels: { email: true, push: true } });
    expect(preview.recipients).toBe(2);
    expect(preview.email).toEqual({ configured: true, reachable: 1 });
    expect(preview.push.reachable).toBe(0);
    await expect(comms.previewAnnouncement({ kind: "INFO", title: "Vide", body: "Sans critère.", target: "targeted" })).rejects.toMatchObject({ status: 422 });

    const r = await comms.publishAnnouncement(root, { kind: "MAINTENANCE", title: "Maintenance", body: "Coupure ce soir.", target: "all", channels: { email: true, push: true }, confirm: true });
    sent.length = 0;
    const d = await comms.deliverAnnouncement(r.id, "https://niala.test");
    expect(d.emailSent).toBe(1);
    expect(JSON.stringify(sent[0].body)).toContain("etu@niala.test");
    expect(JSON.stringify(sent[0].body)).toContain("/desinscription?t=");
    expect(await ctx.db.userNotification.count({ where: { refId: r.id } })).toBe(2);

    await comms.deleteAnnouncement(root, r.id);
    expect(await ctx.db.userNotification.count({ where: { refId: r.id } })).toBe(0);
    expect((await comms.listAnnouncements()).some((a) => a.id === r.id)).toBe(false);
    expect(await lib.dbAll.announcement.count({ where: { id: r.id } })).toBe(1);
  });

  it("la désinscription par lien signé coupe les annonces par e-mail", async () => {
    await expect(comms.unsubscribeFromEmails(`${student}.faux`)).rejects.toMatchObject({ status: 404 });
    await comms.unsubscribeFromEmails(comms.unsubscribeToken(student));
    expect((await ctx.db.userSettings.findUniqueOrThrow({ where: { userId: student } })).emailAnnouncements).toBe(false);
  });
});
