// Back-office : rôles, connexion administrateur, gestion des comptes, demandes, annonces, journal d'audit, exports, historique.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { startTestDb } from "@/server/admin/test-db";

type Ctx = Awaited<ReturnType<typeof startTestDb>>;
let ctx: Ctx;
let rbac: typeof import("@/server/admin/rbac");
let session: typeof import("@/server/admin/session");
let adminAuth: typeof import("@/server/admin/auth");
let users: typeof import("@/server/admin/users");
let support: typeof import("@/server/admin/support");
let comms: typeof import("@/server/admin/comms");
let settings: typeof import("@/server/admin/settings");
let exporters: typeof import("@/server/admin/exporters");
let reports: typeof import("@/server/admin/reports");
let common: typeof import("@/server/admin/stats/common");
let backfill: typeof import("@/server/analytics/backfill");
let track: typeof import("@/server/analytics/track");
let requestLog: typeof import("@/server/analytics/request-log");
let auth: typeof import("@/lib/auth");

const PASSWORD = "mot-de-passe-de-test-123";
const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
let superAdmin: AdminUserT;
let support1: AdminUserT;
let analyst: AdminUserT;
type AdminUserT = import("@/server/admin/session").AdminUser;

const asAdmin = (u: { id: string; email: string; name: string | null }, role: import("@/server/admin/rbac").AdminRole): AdminUserT => ({ id: u.id, email: u.email, name: u.name, role, permissions: rbac.permissionsOf(role) });

async function mk(email: string, o: { admin?: import("@/server/admin/rbac").AdminRole; category?: string; name?: string; createdAt?: Date; password?: string; status?: string } = {}) {
  return ctx.db.user.create({
    data: { email, name: o.name ?? email.split("@")[0], passwordHash: auth.hashPassword(o.password ?? PASSWORD), adminRole: o.admin ?? null, accountStatus: o.status ?? "ACTIVE", createdAt: o.createdAt ?? new Date(), ...(o.category ? { profile: { create: { category: o.category, institution: o.category === "ESATIC" ? "ESATIC" : "Autre", level: "L3", field: "Informatique" } } } : {}), settings: { create: {} } },
  });
}

beforeAll(async () => {
  process.env.STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), "niala-support-"));
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  ctx = await startTestDb();
  auth = await import("@/lib/auth");
  rbac = await import("@/server/admin/rbac");
  session = await import("@/server/admin/session");
  adminAuth = await import("@/server/admin/auth");
  users = await import("@/server/admin/users");
  support = await import("@/server/admin/support");
  comms = await import("@/server/admin/comms");
  settings = await import("@/server/admin/settings");
  exporters = await import("@/server/admin/exporters");
  reports = await import("@/server/admin/reports");
  common = await import("@/server/admin/stats/common");
  backfill = await import("@/server/analytics/backfill");
  track = await import("@/server/analytics/track");
  requestLog = await import("@/server/analytics/request-log");
  superAdmin = asAdmin(await mk("root@niala.test", { admin: "SUPER_ADMIN", name: "Root" }), "SUPER_ADMIN");
  support1 = asAdmin(await mk("aide@niala.test", { admin: "SUPPORT", name: "Aide" }), "SUPPORT");
  analyst = asAdmin(await mk("stats@niala.test", { admin: "ANALYST", name: "Stats" }), "ANALYST");
}, 120_000);

afterAll(async () => {
  await ctx?.stop();
});

describe("rôles et permissions (RBAC)", () => {
  it("donne à chaque rôle exactement ce que décrit la spécification", () => {
    const { can } = rbac;
    expect(rbac.PERMISSIONS.every((p) => can("SUPER_ADMIN", p))).toBe(true);
    expect(can("ADMIN", "users.manage") && can("ADMIN", "support.manage") && can("ADMIN", "reports.export")).toBe(true);
    expect(can("ADMIN", "admins.manage")).toBe(false);
    expect(can("ADMIN", "settings.manage")).toBe(false);
    expect(can("ADMIN", "data.backfill")).toBe(false);
    expect(can("SUPPORT", "support.manage") && can("SUPPORT", "users.support")).toBe(true);
    expect(can("SUPPORT", "users.view") || can("SUPPORT", "reports.view") || can("SUPPORT", "overview.view") || can("SUPPORT", "comms.send")).toBe(false);
    expect(can("ANALYST", "overview.view") && can("ANALYST", "reports.export") && can("ANALYST", "tech.view")).toBe(true);
    expect(can("ANALYST", "users.view") || can("ANALYST", "support.view") || can("ANALYST", "users.manage") || can("ANALYST", "audit.view")).toBe(false);
    expect(can(null, "overview.view")).toBe(false);
    expect(can(undefined, "overview.view")).toBe(false);
  });

  it("n'affiche à chaque rôle que les rubriques autorisées et choisit une page d'arrivée accessible", () => {
    expect(rbac.sectionsFor("SUPER_ADMIN")).toHaveLength(12);
    expect(rbac.sectionsFor("SUPPORT").map((s) => s.key)).toEqual(["users", "requests"]);
    expect(rbac.sectionsFor("ANALYST").map((s) => s.key)).toEqual(["overview", "usage", "features", "pedagogy", "reports", "tech", "ai"]);
    expect(rbac.landingFor("SUPPORT")).toBe("/admin/utilisateurs");
    expect(rbac.landingFor("ANALYST")).toBe("/admin");
  });
});

describe("session d'administration", () => {
  it("signe le jeton, refuse toute altération, l'expiration et un autre domaine de signature", () => {
    const token = session.createAdminToken("u1", 3, 1_000);
    expect(session.verifyAdminToken(token, 2_000)).toEqual({ userId: "u1", version: 3 });
    expect(session.verifyAdminToken(token, 1_000 + session.ADMIN_SESSION_TTL_MS + 1)).toBeNull();
    const [id, exp, version, sig] = token.split(".");
    expect(session.verifyAdminToken([id, exp, "9", sig].join("."), 2_000)).toBeNull();
    expect(session.verifyAdminToken([id.replace("u1", "u2"), exp, version, sig].join("."), 2_000)).toBeNull();
    expect(session.verifyAdminToken("n'importe quoi", 2_000)).toBeNull();
    // Un jeton de session étudiante (autre cookie, autre signature) n'ouvre pas le back-office
    expect(session.verifyAdminToken(`u1.${Date.now() + 100000}.0.${auth.hmacFor("autre-domaine", "u1")}`)).toBeNull();
    expect(session.ADMIN_COOKIE).not.toBe("sfs_session");
    expect(session.ADMIN_SESSION_TTL_MS).toBeLessThan(7 * 24 * 3600 * 1000);
  });
});

describe("connexion administrateur", () => {
  it("ouvre une session pour un administrateur et journalise la connexion", async () => {
    const r = await adminAuth.loginAdminWithPassword("ROOT@niala.test", PASSWORD, { ip: "10.0.0.1" });
    expect(r).toMatchObject({ userId: superAdmin.id, role: "SUPER_ADMIN", landing: "/admin" });
    const log = await ctx.db.adminAuditLog.findFirst({ where: { action: "admin.login", actorId: superAdmin.id } });
    expect(log).not.toBeNull();
    expect((log!.detail as { ip: string }).ip).toBe("10.0.0.1");
  });

  it("répond de la même façon pour un compte inconnu, un mauvais mot de passe et un simple étudiant", async () => {
    await mk("etudiant@niala.test", { category: "ESATIC" });
    const messages = new Set<string>();
    for (const [email, pw] of [["inconnu@niala.test", PASSWORD], ["root@niala.test", "mauvais"], ["etudiant@niala.test", PASSWORD]] as const) {
      await adminAuth.loginAdminWithPassword(email, pw, { ip: null }).catch((e: Error & { status?: number }) => {
        expect(e.status).toBe(401);
        messages.add(e.message);
      });
    }
    expect(messages.size).toBe(1);
    expect(await ctx.db.adminAuditLog.count({ where: { action: "admin.login_failed" } })).toBe(3);
  });

  it("refuse un administrateur dont le compte est suspendu", async () => {
    await mk("susp@niala.test", { admin: "ADMIN", status: "SUSPENDED" });
    await expect(adminAuth.loginAdminWithPassword("susp@niala.test", PASSWORD, { ip: null })).rejects.toMatchObject({ status: 401 });
  });

  it("ne crée jamais de compte via Google et n'ouvre que les comptes déjà liés", async () => {
    const profile = { sub: "g-new", email: "nouveau@gmail.test", emailVerified: true, name: "Nouveau", firstName: null, lastName: null, avatarUrl: null };
    await expect(adminAuth.loginAdminWithGoogle(profile, { ip: null })).rejects.toMatchObject({ status: 401 });
    expect(await ctx.db.user.count({ where: { email: "nouveau@gmail.test" } })).toBe(0);
    // compte à mot de passe, non lié : refusé même avec le bon e-mail
    await expect(adminAuth.loginAdminWithGoogle({ ...profile, email: "aide@niala.test" }, { ip: null })).rejects.toMatchObject({ status: 401 });
    // compte lié et administrateur : accepté
    await ctx.db.user.update({ where: { id: support1.id }, data: { googleSub: "g-aide" } });
    const ok = await adminAuth.loginAdminWithGoogle({ ...profile, sub: "g-aide", email: "aide@niala.test" }, { ip: null });
    expect(ok.role).toBe("SUPPORT");
    // lié mais sans rôle : refusé
    const student = await mk("lie@niala.test", { category: "TESTER" });
    await ctx.db.user.update({ where: { id: student.id }, data: { googleSub: "g-lie" } });
    await expect(adminAuth.loginAdminWithGoogle({ ...profile, sub: "g-lie", email: "lie@niala.test" }, { ip: null })).rejects.toMatchObject({ status: 401 });
  });
});

describe("gestion des utilisateurs", () => {
  it("liste, recherche, filtre, trie et pagine", async () => {
    for (let i = 0; i < 30; i++) await mk(`liste${String(i).padStart(2, "0")}@niala.test`, { category: i % 3 === 0 ? "ESATIC" : i % 3 === 1 ? "OTHER_SCHOOL" : "TESTER", name: `Liste ${i}`, createdAt: ago(i) });
    const page1 = await users.listUsers(superAdmin, { q: "liste", sort: "email", dir: "asc" });
    expect(page1.total).toBe(30);
    expect(page1.rows).toHaveLength(users.PAGE_SIZE);
    expect(page1.pages).toBe(2);
    expect(page1.rows[0].email).toBe("liste00@niala.test");
    const page2 = await users.listUsers(superAdmin, { q: "liste", sort: "email", dir: "asc", page: 2 });
    expect(page2.rows).toHaveLength(5);
    expect((await users.listUsers(superAdmin, { q: "liste", category: "ESATIC" })).total).toBe(10);
    expect((await users.listUsers(superAdmin, { q: "liste", institution: "ESATIC" })).total).toBe(10);
    expect((await users.listUsers(superAdmin, { q: "liste", from: ago(5).toISOString().slice(0, 10) })).total).toBeLessThanOrEqual(6);
    expect((await users.listUsers(superAdmin, { q: "%" })).total).toBe(0); // les jokers SQL sont neutralisés
    const byDate = await users.listUsers(superAdmin, { q: "liste", sort: "createdAt", dir: "desc" });
    expect(byDate.rows[0].email).toBe("liste00@niala.test");
    expect((await users.listUsers(superAdmin, { q: "liste", activity: "never" })).total).toBe(30);
    await expect(users.listUsers(superAdmin, { sort: "passwordHash" })).rejects.toThrow(); // tri limité à une liste blanche
  });

  it("ne montre les chiffres d'activité qu'aux rôles autorisés", async () => {
    const [target] = (await users.listUsers(superAdmin, { q: "liste00" })).rows;
    const asSupport = await users.listUsers(support1, { q: "liste00", sort: "sessions" });
    expect(asSupport.full).toBe(false);
    expect(asSupport.rows[0]).toMatchObject({ sessions: null, exercises: null, lastActivity: null });
    const detail = await users.getUserDetail(support1, target.id);
    expect(detail.full).toBe(false);
    expect(detail.activity).toBeNull();
    expect(detail.pedagogy).toBeNull();
    expect(detail.info.email).toBe(target.email);
  });

  it("n'expose dans la fiche ni conversations, ni notes, ni contenu de cours, ni secret", async () => {
    const u = await mk("fiche@niala.test", { category: "ESATIC" });
    const subject = await ctx.db.subject.create({ data: { userId: u.id, name: "Algorithmique" } });
    await ctx.db.note.create({ data: { userId: u.id, subjectId: subject.id, kind: "PERSONAL", title: "Mes notes", content: { text: "SECRET-NOTE-PRIVEE" } } });
    await ctx.db.conversation.create({ data: { userId: u.id, scope: "GLOBAL", title: "SECRET-CONVERSATION", messages: { create: { userId: u.id, role: "USER", content: "SECRET-QUESTION-IA" } } } });
    await track.recordEvent(u.id, "exercise.generate", { module: "exercises" });
    const detail = await users.getUserDetail(superAdmin, u.id);
    const json = JSON.stringify(detail);
    expect(json).not.toMatch(/SECRET-/);
    expect(json).not.toMatch(/passwordHash|scrypt\$|googleSub|sessionVersion/);
    expect(detail.activity!.events.map((e) => e.type)).toContain("exercise.generate");
    expect(detail.pedagogy!.subjects.map((s) => s.name)).not.toContain("SECRET");
    // La consultation d'une fiche est journalisée
    expect(await ctx.db.adminAuditLog.count({ where: { action: "user.view", targetId: u.id } })).toBeGreaterThan(0);
  });

  it("suspend, réactive et désactive en fermant les sessions, avec motif et journal", async () => {
    const u = await mk("cible@niala.test", { category: "TESTER" });
    await expect(users.setAccountStatus(superAdmin, u.id, { status: "SUSPENDED" })).rejects.toMatchObject({ status: 422 }); // motif obligatoire
    await users.setAccountStatus(superAdmin, u.id, { status: "SUSPENDED", reason: "usage abusif" });
    const suspended = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(suspended).toMatchObject({ accountStatus: "SUSPENDED", statusReason: "usage abusif" });
    expect(suspended.sessionVersion).toBe(u.sessionVersion + 1); // les sessions ouvertes ne sont plus valables
    await expect(users.setAccountStatus(superAdmin, u.id, { status: "SUSPENDED", reason: "encore" })).rejects.toMatchObject({ status: 409 });
    await users.setAccountStatus(superAdmin, u.id, { status: "ACTIVE" });
    expect((await ctx.db.user.findUniqueOrThrow({ where: { id: u.id } })).statusReason).toBeNull();
    await users.setAccountStatus(superAdmin, u.id, { status: "DISABLED", reason: "demande de l'étudiant" });
    const actions = (await ctx.db.adminAuditLog.findMany({ where: { targetId: u.id }, orderBy: { createdAt: "asc" } })).map((l) => l.action).filter((a) => a !== "user.view");
    expect(actions).toEqual(["user.suspend", "user.reactivate", "user.disable"]);
  });

  it("protège les comptes d'administration et son propre compte", async () => {
    await expect(users.setAccountStatus(superAdmin, superAdmin.id, { status: "SUSPENDED", reason: "test" })).rejects.toMatchObject({ status: 403 });
    await expect(users.setAccountStatus(superAdmin, support1.id, { status: "SUSPENDED", reason: "test" })).rejects.toMatchObject({ status: 403 });
    await expect(users.deleteUserAccount(superAdmin, support1.id, { confirmEmail: support1.email })).rejects.toMatchObject({ status: 403 });
    await expect(users.getUserDetail(superAdmin, support1.id)).rejects.toMatchObject({ status: 404 });
  });

  it("modifie des renseignements administratifs sans toucher à l'e-mail ni au mot de passe", async () => {
    const u = await mk("modif@niala.test", { category: "TESTER", name: "Avant" });
    await users.updateAdminInfo(superAdmin, u.id, { name: "Après", institution: "ESATIC", category: "ESATIC", email: "pirate@x.fr", passwordHash: "x" });
    const after = await ctx.db.user.findUniqueOrThrow({ where: { id: u.id }, include: { profile: true } });
    expect(after.name).toBe("Après");
    expect(after.email).toBe("modif@niala.test");
    expect(after.passwordHash).toBe(u.passwordHash);
    expect(after.profile).toMatchObject({ category: "ESATIC", institution: "ESATIC" });
    await expect(users.updateAdminInfo(superAdmin, u.id, {})).rejects.toMatchObject({ status: 422 });
    const log = await ctx.db.adminAuditLog.findFirstOrThrow({ where: { action: "user.update", targetId: u.id } });
    expect(JSON.stringify(log.detail)).not.toContain("pirate");
  });

  it("supprime un compte seulement après saisie de son adresse, et conserve les statistiques pseudonymisées", async () => {
    const u = await mk("supprime@niala.test", { category: "ESATIC" });
    await track.recordEvent(u.id, "module.open", { module: "exercises" });
    await ctx.db.supportRequest.create({ data: { reference: "NL-TEST-DEL", userId: u.id, type: "BUG", subject: "x", description: "description suffisante" } });
    await expect(users.deleteUserAccount(superAdmin, u.id, { confirmEmail: "autre@niala.test" })).rejects.toMatchObject({ status: 422 });
    expect(await ctx.db.user.count({ where: { id: u.id } })).toBe(1);
    await users.deleteUserAccount(superAdmin, u.id, { confirmEmail: "SUPPRIME@niala.test" });
    expect(await ctx.db.user.count({ where: { id: u.id } })).toBe(0);
    expect(await ctx.db.supportRequest.count({ where: { userId: u.id } })).toBe(0);
    expect(await ctx.db.analyticsEvent.count({ where: { actorKey: track.actorKeyOf(u.id) } })).toBe(1);
    expect(await ctx.db.adminAuditLog.count({ where: { action: "user.delete", targetId: u.id } })).toBe(1);
  });
});

describe("demandes des étudiants", () => {
  const input = { type: "FEATURE", subject: "Export PDF", description: "Je voudrais exporter mes exercices en PDF.", module: "exercises", urgency: "HIGH" };
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  let student: { id: string; email: string };

  it("génère une référence de suivi, rattache la demande au compte et enregistre l'événement", async () => {
    student = await mk("demandeur@niala.test", { category: "ESATIC" });
    const a = await support.submitRequest(student.id, input);
    const b = await support.submitRequest(student.id, { ...input, type: "BUG", subject: "Bug" });
    expect(a.reference).toMatch(/^NL-\d{4}-\d{4}$/);
    expect(b.reference).not.toBe(a.reference);
    const row = await ctx.db.supportRequest.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ userId: student.id, status: "RECEIVED", priority: "HIGH", urgency: "HIGH" });
    await new Promise((r) => setTimeout(r, 200));
    expect(await ctx.db.analyticsEvent.count({ where: { type: "suggestion.submit", actorKey: track.actorKeyOf(student.id) } })).toBe(2);
  });

  it("valide le formulaire et les pièces jointes (taille, type, vraie signature)", async () => {
    await expect(support.submitRequest(student.id, { ...input, subject: "x" })).rejects.toThrow();
    await expect(support.submitRequest(student.id, { ...input, type: "AUTRE" })).rejects.toThrow();
    await expect(support.submitRequest(student.id, { ...input, module: "inconnu" })).rejects.toMatchObject({ status: 422 });
    await expect(support.submitRequest(student.id, input, [{ name: "faux.png", mime: "image/png", data: Buffer.from("MZ exécutable") }])).rejects.toMatchObject({ status: 422 });
    await expect(support.submitRequest(student.id, input, [{ name: "a.exe", mime: "application/x-msdownload", data: PNG }])).rejects.toMatchObject({ status: 422 });
    await expect(support.submitRequest(student.id, input, [{ name: "gros.png", mime: "image/png", data: Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]) }])).rejects.toMatchObject({ status: 422 });
    const four = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png`, mime: "image/png", data: PNG }));
    await expect(support.submitRequest(student.id, input, four)).rejects.toMatchObject({ status: 422 });
    const ok = await support.submitRequest(student.id, input, [{ name: "capture écran.png", mime: "image/png", data: PNG }]);
    const mine = await support.getMyRequest(student.id, ok.id);
    expect(mine.attachments).toHaveLength(1);
    const file = await support.readAttachment(ok.id, 0, { userId: student.id });
    expect(file.data.equals(PNG)).toBe(true);
    const other = await mk("curieux@niala.test", { category: "TESTER" });
    await expect(support.readAttachment(ok.id, 0, { userId: other.id })).rejects.toMatchObject({ status: 404 });
  });

  it("n'expose jamais les notes internes à l'étudiant et notifie ses réponses et changements de statut", async () => {
    const [req] = await ctx.db.supportRequest.findMany({ where: { userId: student.id, type: "FEATURE" }, orderBy: { createdAt: "asc" } });
    await support.addInternalNote(support1, req.id, "NOTE INTERNE : à ne jamais montrer");
    await support.replyToRequest(support1, req.id, { body: "Merci, nous étudions votre idée." });
    const mine = await support.getMyRequest(student.id, req.id);
    expect(mine.messages.map((m) => m.body)).toEqual(["Merci, nous étudions votre idée."]);
    expect(JSON.stringify(mine)).not.toContain("NOTE INTERNE");
    const adminView = await support.getRequestAdmin(support1, req.id);
    expect(adminView.messages.filter((m) => m.internal)).toHaveLength(1);
    expect(adminView.status).toBe("IN_PROGRESS"); // une première réponse met la demande en traitement
    expect(adminView.firstReplyAt).not.toBeNull();

    await support.updateRequest(support1, req.id, { status: "NEEDS_INFO", priority: "URGENT", assigneeId: support1.id });
    const notes = await support.listNotifications(student.id);
    expect(notes.unread).toBe(2);
    expect(notes.items.map((n) => n.kind).sort()).toEqual(["REQUEST_REPLY", "REQUEST_UPDATE"]);
    expect(notes.items.find((n) => n.kind === "REQUEST_UPDATE")!.title).toContain("information complémentaire");
    await support.markNotificationsRead(student.id);
    expect((await support.listNotifications(student.id)).unread).toBe(0);

    // La réponse de l'étudiant à une demande d'information relance le traitement ; une demande clôturée n'accepte plus de message.
    await support.replyAsUser(student.id, req.id, "Voici le détail demandé.");
    expect((await ctx.db.supportRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING_REVIEW");
    await support.updateRequest(support1, req.id, { status: "RESOLVED" });
    expect((await ctx.db.supportRequest.findUniqueOrThrow({ where: { id: req.id } })).closedAt).not.toBeNull();
    await expect(support.replyAsUser(student.id, req.id, "Encore un message")).rejects.toMatchObject({ status: 409 });
    const other = await mk("autre-etudiant@niala.test", { category: "TESTER" });
    await expect(support.getMyRequest(other.id, req.id)).rejects.toMatchObject({ status: 404 });
    await expect(support.replyAsUser(other.id, req.id, "intrus")).rejects.toMatchObject({ status: 404 });
  });

  it("filtre les demandes, compte les statuts et regroupe les besoins récurrents en feuille de route", async () => {
    const a = await support.submitRequest(student.id, { ...input, subject: "Mode sombre dans l'éditeur de code", description: "Un thème sombre pour l'éditeur de code serait agréable le soir." });
    const b = await support.submitRequest(student.id, { ...input, subject: "Thème sombre de l'éditeur de code", description: "Pouvoir passer l'éditeur de code en thème sombre le soir." });
    const similar = await support.similarRequests(a.id);
    expect(similar.map((s) => s.id)).toContain(b.id);
    expect(similar[0].score).toBeGreaterThanOrEqual(25);

    const { id } = await support.createRoadmapItem(superAdmin, { title: "Thème sombre de l'éditeur", requestIds: [a.id, b.id] });
    expect(await ctx.db.supportRequest.count({ where: { roadmapItemId: id } })).toBe(2);
    expect((await support.listRoadmap())[0]).toMatchObject({ title: "Thème sombre de l'éditeur", status: "TO_STUDY", requests: 2 });
    await ctx.db.userNotification.deleteMany({ where: { userId: student.id } });
    await support.updateRoadmapItem(superAdmin, id, { status: "DEPLOYED" });
    expect((await support.listNotifications(student.id)).items[0].title).toContain("disponible");
    const analytics = await support.getRequestAnalytics(common.resolvePeriod({ p: "30d" }));
    expect(analytics.recurring[0]).toMatchObject({ title: "Thème sombre de l'éditeur", requests: 2 });
    expect(analytics.byType.map((t) => t.key)).toContain("FEATURE");

    const open = await support.listRequests({ open: "1", sort: "priority", dir: "desc" });
    expect(open.rows.every((r) => !["RESOLVED", "REJECTED"].includes(r.status))).toBe(true);
    expect((await support.listRequests({ q: "demandeur@" })).total).toBeGreaterThan(0);
    expect((await support.listRequests({ type: "BUG" })).rows.every((r) => r.type === "BUG")).toBe(true);
    await expect(support.listRequests({ sort: "description" })).rejects.toThrow();
    const counts = await support.requestCounts();
    expect(counts.total).toBe(await ctx.db.supportRequest.count());
    expect(counts.resolved).toBe(1);
  });

  it("limite le nombre de demandes par étudiant et par jour (paramètre modifiable)", async () => {
    const spammer = await mk("spam@niala.test", { category: "TESTER" });
    await settings.updateSetting(superAdmin, "requests.dailyPerUser", 2);
    await support.submitRequest(spammer.id, input);
    await support.submitRequest(spammer.id, input);
    await expect(support.submitRequest(spammer.id, input)).rejects.toMatchObject({ status: 429 });
    await settings.updateSetting(superAdmin, "requests.dailyPerUser", 10);
  });
});

describe("communications", () => {
  it("cible l'audience, exige une confirmation, plafonne et évite les doublons", async () => {
    const before = await ctx.db.userNotification.count();
    const preview = await comms.previewAnnouncement({ kind: "INFO", title: "Nouveauté", body: "Un nouveau module arrive.", audience: { categories: ["ESATIC"] } });
    const esatic = await ctx.db.user.count({ where: { adminRole: null, accountStatus: "ACTIVE", profile: { is: { category: "ESATIC" } } } });
    expect(preview.recipients).toBe(esatic);
    expect(preview.dailyLimit).toBe(3);

    await expect(comms.publishAnnouncement(superAdmin, { kind: "INFO", title: "Nouveauté", body: "Un nouveau module arrive.", audience: { categories: ["ESATIC"] } })).rejects.toThrow(); // pas de confirmation
    expect(await ctx.db.userNotification.count()).toBe(before);

    const r = await comms.publishAnnouncement(superAdmin, { kind: "FEATURE", title: "Nouveauté", body: "Un nouveau module arrive.", audience: { categories: ["ESATIC"] }, confirm: true });
    expect(r.recipients).toBe(esatic);
    expect(await ctx.db.userNotification.count()).toBe(before + esatic);
    expect(await ctx.db.userNotification.count({ where: { kind: "ANNOUNCEMENT", user: { OR: [{ adminRole: { not: null } }, { accountStatus: { not: "ACTIVE" } }] } } })).toBe(0); // ni admins ni comptes suspendus

    await expect(comms.publishAnnouncement(superAdmin, { kind: "FEATURE", title: "Nouveauté", body: "Un nouveau module arrive.", audience: {}, confirm: true })).rejects.toMatchObject({ status: 409 });
    await expect(comms.publishAnnouncement(superAdmin, { kind: "INFO", title: "Audience vide", body: "Aucun destinataire.", audience: { institutions: ["Inexistant"] }, confirm: true })).rejects.toMatchObject({ status: 422 });
    await comms.publishAnnouncement(superAdmin, { kind: "INFO", title: "Deuxième", body: "Message numéro deux.", audience: { categories: ["TESTER"] }, confirm: true });
    await comms.publishAnnouncement(superAdmin, { kind: "MAINTENANCE", title: "Troisième", body: "Maintenance ce soir.", audience: { categories: ["TESTER"] }, confirm: true });
    await expect(comms.publishAnnouncement(superAdmin, { kind: "INFO", title: "Quatrième", body: "Au-delà du plafond.", audience: {}, confirm: true })).rejects.toMatchObject({ status: 429 });
    expect((await comms.listAnnouncements()).length).toBe(3);
    expect(await ctx.db.adminAuditLog.count({ where: { action: "announcement.publish" } })).toBe(3);
  });
});

describe("paramètres et rôles d'administration", () => {
  it("valide les paramètres, journalise les changements et refuse les clés inconnues", async () => {
    expect(await settings.getSetting("announcements.dailyLimit")).toBe(3);
    await expect(settings.updateSetting(superAdmin, "announcements.dailyLimit", 0)).rejects.toMatchObject({ status: 422 });
    await expect(settings.updateSetting(superAdmin, "announcements.dailyLimit", "beaucoup")).rejects.toMatchObject({ status: 422 });
    await expect(settings.updateSetting(superAdmin, "secret.cle", 1)).rejects.toMatchObject({ status: 404 });
    await settings.updateSetting(superAdmin, "alerts.enabled", false);
    expect(await settings.getSetting("alerts.enabled")).toBe(false);
    await settings.updateSetting(superAdmin, "alerts.enabled", true);
    const log = await ctx.db.adminAuditLog.findFirstOrThrow({ where: { action: "setting.update", targetId: "alerts.enabled" }, orderBy: { createdAt: "asc" } });
    expect(log.detail).toEqual({ from: true, to: false });
  });

  it("attribue et retire des rôles, sans auto-promotion ni suppression du dernier super administrateur", async () => {
    const candidate = await mk("futur-admin@niala.test", { category: "TESTER" });
    await settings.setAdminRole(superAdmin, { email: "FUTUR-ADMIN@niala.test", role: "ADMIN" });
    expect((await ctx.db.user.findUniqueOrThrow({ where: { id: candidate.id } })).adminRole).toBe("ADMIN");
    await settings.setAdminRole(superAdmin, { email: "futur-admin@niala.test", role: "NONE" });
    const revoked = await ctx.db.user.findUniqueOrThrow({ where: { id: candidate.id } });
    expect(revoked.adminRole).toBeNull();
    expect(revoked.sessionVersion).toBe(candidate.sessionVersion + 1);
    await expect(settings.setAdminRole(superAdmin, { email: "root@niala.test", role: "ADMIN" })).rejects.toMatchObject({ status: 403 }); // pas son propre rôle
    await expect(settings.setAdminRole(superAdmin, { email: "inconnu@niala.test", role: "ADMIN" })).rejects.toMatchObject({ status: 404 });
    await expect(settings.setAdminRole(superAdmin, { email: "aide@niala.test", role: "SUPER_ADMIN" })).resolves.toEqual({ ok: true });
    const second = asAdmin(await ctx.db.user.findUniqueOrThrow({ where: { id: support1.id } }), "SUPER_ADMIN");
    await expect(settings.setAdminRole(second, { email: "root@niala.test", role: "NONE" })).resolves.toEqual({ ok: true });
    await expect(settings.setAdminRole(superAdmin, { email: "aide@niala.test", role: "ADMIN" })).rejects.toMatchObject({ status: 409 }); // dernier super administrateur
    await ctx.db.user.update({ where: { id: superAdmin.id }, data: { adminRole: "SUPER_ADMIN" } });
    await ctx.db.user.update({ where: { id: support1.id }, data: { adminRole: "SUPPORT" } });
  });
});

describe("journal d'audit", () => {
  it("refuse toute modification ou suppression, même par l'application", async () => {
    await expect(ctx.db.adminAuditLog.updateMany({ data: { result: "SUCCESS" } })).rejects.toThrow(/ajout seul/);
    await expect(ctx.db.adminAuditLog.deleteMany({})).rejects.toThrow(/ajout seul/);
    await expect(ctx.db.$executeRawUnsafe(`TRUNCATE "AdminAuditLog"`)).rejects.toThrow(/ajout seul/);
  });

  it("conserve l'administrateur, l'action, l'objet, le résultat et l'heure", async () => {
    const { audit } = await import("@/server/admin/audit"); // le journal est en ajout seul : on retrouve ses entrées par un objet dédié
    await audit(superAdmin, "setting.update", { targetType: "setting", targetId: "objet-test-audit", detail: { from: 1, to: 2 } });
    await audit(null, "access.denied", { targetType: "permission", targetId: "objet-test-audit", result: "DENIED" });
    const rows = await ctx.db.adminAuditLog.findMany({ where: { targetId: "objet-test-audit" }, orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actorId: superAdmin.id, actorEmail: superAdmin.email, action: "setting.update", targetType: "setting", targetId: "objet-test-audit", result: "SUCCESS" });
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ result: "DENIED", actorId: null });
  });
});

describe("collecte analytique", () => {
  it("pseudonymise l'utilisateur et ne conserve aucune donnée personnelle", async () => {
    const u = await mk("pseudo@niala.test", { category: "ESATIC", name: "Pseudo Nyme" });
    await track.recordEvent(u.id, "exercise.generate", { module: "exercises", props: { origin: "FREE" } });
    const ev = await ctx.db.analyticsEvent.findFirstOrThrow({ where: { actorKey: track.actorKeyOf(u.id), type: "exercise.generate" } });
    expect(ev.actorKey).not.toContain(u.id);
    expect(ev.category).toBe("ESATIC");
    expect(JSON.stringify(ev)).not.toMatch(/pseudo@niala|Pseudo|Nyme/);
    expect(track.actorKeyOf(u.id)).toBe(track.actorKeyOf(u.id));
    expect(track.actorKeyOf(u.id)).not.toBe(track.actorKeyOf("autre"));
  });

  it("évite les doublons d'un même événement source et ne lève jamais d'erreur", async () => {
    const u = await mk("doublon@niala.test", { category: "TESTER" });
    await track.recordEvent(u.id, "exercise.start", { sourceRef: "attempt-1" });
    await track.recordEvent(u.id, "exercise.start", { sourceRef: "attempt-1" });
    expect(await ctx.db.analyticsEvent.count({ where: { type: "exercise.start", sourceRef: "attempt-1" } })).toBe(1);
    await expect(track.recordEvent(u.id, "module.open", { props: { x: BigInt(1) as unknown as number } })).resolves.toBeUndefined();
  });

  it("reconstitue l'historique depuis les tables d'origine, sans doublon et en le signalant", async () => {
    const u = await mk("histo@niala.test", { category: "ESATIC", createdAt: ago(20) });
    const subject = await ctx.db.subject.create({ data: { userId: u.id, name: "SQL" } });
    const ex = await ctx.db.exercise.create({ data: { userId: u.id, subjectId: subject.id, title: "Jointures", config: {}, totalPoints: 10, createdAt: ago(10) } });
    const start = ago(9);
    await ctx.db.exerciseAttempt.create({ data: { userId: u.id, exerciseId: ex.id, snapshot: {}, status: "GRADED", score: 7, maxScore: 10, startedAt: start, finishedAt: new Date(start.getTime() + 600_000) } });
    const first = await backfill.backfillAnalytics();
    const inserted = Object.fromEntries(first.map((r) => [r.type, r.inserted]));
    expect(inserted["exercise.generate"]).toBeGreaterThanOrEqual(1);
    expect(inserted["exercise.complete"]).toBeGreaterThanOrEqual(1);
    const mine = await ctx.db.analyticsEvent.findMany({ where: { actorKey: track.actorKeyOf(u.id) } });
    expect(mine.every((e) => e.source === "BACKFILL")).toBe(true);
    expect(mine.find((e) => e.type === "exercise.generate")!.createdAt.getTime()).toBe(ex.createdAt.getTime()); // date réelle, pas la date de reconstitution
    const second = await backfill.backfillAnalytics();
    expect(second.reduce((s, r) => s + r.inserted, 0)).toBe(0);
  });

  it("classe les erreurs d'API sans conserver de contenu", () => {
    expect(requestLog.classifyStatus(200)).toBeNull();
    expect(requestLog.classifyStatus(404)).toBe("USER");
    expect(requestLog.classifyStatus(429)).toBe("USER");
    expect(requestLog.classifyStatus(500)).toBe("APP");
    expect(requestLog.classifyStatus(503)).toBe("EXTERNAL");
    expect(requestLog.moduleOfRoute("/api/files/abc/text")).toBe("documents");
    expect(requestLog.moduleOfRoute("/api/exercises/x/attempts")).toBe("exercises");
    expect(requestLog.normalizeRoute("/api/files/ckx9a8b7c6d5e4f3g2h1i0j9k/text")).toBe("/api/files/:id/text");
    class AiCallError extends Error {}
    expect(requestLog.classifyError(new AiCallError("x"), 500)).toBe("EXTERNAL");
    expect(requestLog.classifyError(new Error("bug"), 500)).toBe("APP");
  });
});

describe("rapports et exports", () => {
  it("construit chaque rapport avec la période demandée et refuse un rapport inconnu", async () => {
    const period = common.resolvePeriod({ p: "30d" });
    for (const r of reports.REPORTS) {
      const report = await reports.buildReport(r.key, period);
      expect(report.period.label).toBe(period.label);
      expect(report.tables.length).toBeGreaterThan(0);
      expect(report.notes.length).toBeGreaterThan(0);
    }
    await expect(reports.buildReport("inconnu", period)).rejects.toThrow();
  });

  it("produit un CSV lisible par Excel, protégé contre l'injection de formules", async () => {
    const report = { ...(await reports.buildReport("features", common.resolvePeriod({ p: "7d" }))), tables: [{ title: "Test", columns: ["Nom", "Valeur"], rows: [["=HYPERLINK(\"http://x\")", 1], ["a;b \"c\"", null], ["+cmd", 2.5]] as import("@/server/admin/reports").Cell[][] }] };
    const csv = exporters.renderCsv(report);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+cmd");
    expect(csv).toContain('"a;b ""c"""');
    expect(csv).toContain("Période : 7 derniers jours");
  });

  it("produit un classeur Excel valide (une feuille par tableau) et un PDF lisible", async () => {
    const period = common.resolvePeriod({ p: "30d" });
    const report = await reports.buildReport("users", period);
    const xlsx = await exporters.renderXlsx(report);
    const zip = await JSZip.loadAsync(xlsx);
    const workbook = await zip.file("xl/workbook.xml")!.async("string");
    const sheets = [...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
    expect(sheets.length).toBe(1 + report.tables.length + report.charts.length);
    expect(new Set(sheets.map((s) => s.toLowerCase())).size).toBe(sheets.length); // noms uniques (règle d'Excel)
    expect(sheets.every((s) => s.length <= 31 && !/^'|'$|[\/?*[\]:]/.test(s))).toBe(true);
    for (let i = 1; i <= sheets.length; i++) {
      const xml = await zip.file(`xl/worksheets/sheet${i}.xml`)!.async("string");
      expect(xml.startsWith("<?xml")).toBe(true);
      expect(xml).not.toMatch(/[\u0000-\u0008]/);
    }
    const pdf = await exporters.renderPdf(report);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    const { PDFDocument } = await import("pdf-lib");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
