import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { hashPassword } from "@/lib/auth";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Mot de passe oublié. Un lien à usage unique est créé ; seule l'empreinte SHA-256 du jeton est conservée en base.
// - Si l'envoi d'e-mails est configuré (RESEND_API_KEY + EMAIL_FROM), le lien part directement à l'étudiant.
// - Sinon, une demande « Mot de passe oublié » arrive à l'équipe Niala, qui crée un lien depuis la fiche de
//   l'étudiant (back-office) et le lui transmet. La réponse à l'étudiant est identique dans tous les cas :
//   elle ne révèle jamais si l'adresse possède un compte.
// ─────────────────────────────────────────────────────────────────────────────

export const MIN_PASSWORD_LENGTH = 10;
const USER_LINK_TTL_MS = 30 * 60_000;
const ADMIN_LINK_TTL_MS = 24 * 3_600_000;
export const RESET_REQUEST_SUBJECT = "Mot de passe oublié";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const hasPassword = (hash: string) => hash.startsWith("scrypt$");

export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email("Adresse e-mail invalide.").max(320) });
export const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`).max(200),
});

export const emailConfigured = () => !!(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());

async function createToken(userId: string, ttlMs: number, createdBy: "USER" | "ADMIN") {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    // Un seul lien valable à la fois : les précédents non utilisés sont retirés.
    db.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    db.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs), createdBy } }),
  ]);
  return token;
}

export const resetUrl = (origin: string, token: string) => `${origin}/reinitialiser-mot-de-passe#${token}`;

async function sendResetEmail(to: string, link: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to,
      subject: "Niala — réinitialisation de votre mot de passe",
      text: `Bonjour,\n\nPour choisir un nouveau mot de passe Niala, ouvrez ce lien (valable 30 minutes, utilisable une seule fois) :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`envoi refusé (${res.status})`);
}

/**
 * Demande depuis la page de connexion. Renvoie toujours la même réponse, que le compte existe ou non.
 * `delivery` indique seulement comment le lien sera transmis, pour adapter le message affiché.
 */
export async function requestPasswordReset(raw: unknown, origin: string): Promise<{ ok: true; delivery: "email" | "team" }> {
  const { email } = forgotSchema.parse(raw);
  const delivery = emailConfigured() ? "email" : "team";
  const user = await db.user.findUnique({ where: { email }, select: { id: true, email: true, passwordHash: true, accountStatus: true } });
  if (!user || user.accountStatus !== "ACTIVE") return { ok: true, delivery };

  if (delivery === "email" && hasPassword(user.passwordHash)) {
    const token = await createToken(user.id, USER_LINK_TTL_MS, "USER");
    try {
      await sendResetEmail(user.email, resetUrl(origin, token));
      return { ok: true, delivery };
    } catch (e) {
      console.error("[password-reset] e-mail non envoyé :", e instanceof Error ? e.message : e);
      await db.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    }
  }
  // Pas d'e-mail possible (ou compte Google sans mot de passe) : l'équipe prend le relais.
  const { fileSystemRequest } = await import("@/server/admin/support");
  await fileSystemRequest(
    user.id,
    RESET_REQUEST_SUBJECT,
    hasPassword(user.passwordHash)
      ? "Demande envoyée depuis la page de connexion. Créez un lien de réinitialisation depuis la fiche de l'étudiant puis transmettez-le-lui par un canal vérifié."
      : "Demande envoyée depuis la page de connexion. Ce compte se connecte avec Google : un lien de réinitialisation lui permettra d'ajouter un mot de passe Niala."
  );
  return { ok: true, delivery: "team" };
}

/** Lien créé par l'équipe depuis le back-office (valable 24 h, usage unique). */
export async function createAdminResetLink(userId: string, origin: string) {
  const token = await createToken(userId, ADMIN_LINK_TTL_MS, "ADMIN");
  return { url: resetUrl(origin, token), expiresAt: new Date(Date.now() + ADMIN_LINK_TTL_MS) };
}

/** Nouveau mot de passe : jeton valable, non utilisé, compte actif. Toutes les sessions ouvertes sont fermées. */
export async function resetPassword(raw: unknown) {
  const { token, password } = resetSchema.parse(raw);
  const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: { select: { accountStatus: true } } } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new ApiHttpError("Ce lien n'est plus valable. Faites une nouvelle demande depuis la page de connexion.", 410);
  if (row.user.accountStatus !== "ACTIVE") throw new ApiHttpError("Ce compte n'est pas actif. Contactez l'équipe Niala.", 403);
  // Consommation atomique : un lien ne sert qu'une fois, même en cas de double envoi.
  const used = await db.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count === 0) throw new ApiHttpError("Ce lien a déjà été utilisé.", 410);
  await db.$transaction([
    db.user.update({ where: { id: row.userId }, data: { passwordHash: hashPassword(password), sessionVersion: { increment: 1 } } }),
    db.passwordResetToken.deleteMany({ where: { userId: row.userId, usedAt: null } }),
  ]);
  return { ok: true };
}
