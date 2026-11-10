import { z } from "zod";
import { Prisma } from "@prisma/client";
import { ApiHttpError } from "@/lib/api-helpers";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { avatarSchema, profileColumns, profileInputSchema } from "@/server/domain/profile";
import { getStorage, withPreviewKeys } from "@/server/storage";
import { MIN_PASSWORD_LENGTH } from "./accounts";

// ─────────────────────────────────────────────────────────────────────────────
// Profil et compte de l'utilisateur connecté : chaque fonction reçoit l'identifiant de la session,
// jamais un identifiant fourni par le client. Aucune donnée technique interne n'est renvoyée.
// ─────────────────────────────────────────────────────────────────────────────

const hasPassword = (hash: string) => hash.startsWith("scrypt$");

export async function getProfile(userId: string) {
  const [user, profile] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, passwordHash: true, googleSub: true, createdAt: true } }),
    db.studentProfile.findUnique({ where: { userId } }),
  ]);
  if (!user) throw new ApiHttpError("Compte introuvable.", 404);
  return {
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    avatar: profile?.avatar ?? null,
    category: profile?.category ?? null,
    institution: profile?.institution ?? null,
    field: profile?.field ?? null,
    situation: profile?.situation ?? null,
    usageReason: profile?.usageReason ?? null,
    auth: { password: hasPassword(user.passwordHash), google: !!user.googleSub || user.passwordHash.startsWith("oauth:google:") },
  };
}

export const profileUpdateSchema = z.object({
  name: z.string().trim().min(1, "Indiquez votre nom et prénom.").max(80, "Nom trop long.").optional(),
  avatar: avatarSchema.optional(),
  academic: profileInputSchema.optional(),
});

export async function updateProfile(userId: string, input: z.infer<typeof profileUpdateSchema>) {
  const columns = input.academic ? profileColumns(input.academic) : {};
  const data = { ...columns, ...(input.avatar !== undefined ? { avatar: input.avatar } : {}) };
  await db.$transaction([
    ...(input.name ? [db.user.update({ where: { id: userId }, data: { name: input.name } })] : []),
    ...(Object.keys(data).length ? [db.studentProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data })] : []),
  ]);
  return getProfile(userId);
}

async function accountWithPassword(userId: string, password: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiHttpError("Compte introuvable.", 404);
  if (!hasPassword(user.passwordHash)) throw new ApiHttpError("Ce compte se connecte avec Google : aucun mot de passe Niala n'y est associé.", 409);
  if (!verifyPassword(password, user.passwordHash)) throw new ApiHttpError("Mot de passe actuel incorrect.", 403);
  return user;
}

export const emailChangeSchema = z.object({ email: z.string().trim().email("Adresse e-mail invalide."), password: z.string().min(1, "Confirmez avec votre mot de passe.").max(200) });

export async function changeEmail(userId: string, input: z.infer<typeof emailChangeSchema>) {
  await accountWithPassword(userId, input.password);
  try {
    const user = await db.user.update({ where: { id: userId }, data: { email: input.email.trim().toLowerCase() } });
    return { email: user.email };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ApiHttpError("Un compte existe déjà avec cette adresse e-mail.", 409);
    throw e;
  }
}

export const passwordChangeSchema = z.object({
  current: z.string().min(1, "Indiquez votre mot de passe actuel.").max(200),
  next: z.string().min(MIN_PASSWORD_LENGTH, `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`).max(200, "Mot de passe trop long."),
});

/** Change le mot de passe et ferme les autres sessions : l'appelant réémet le cookie de la session courante. */
export async function changePassword(userId: string, input: z.infer<typeof passwordChangeSchema>) {
  await accountWithPassword(userId, input.current);
  await db.user.update({ where: { id: userId }, data: { passwordHash: hashPassword(input.next), sessionVersion: { increment: 1 } } });
  return { ok: true };
}

/** Invalide toutes les sessions ouvertes, sur tous les appareils. */
export async function revokeSessions(userId: string) {
  await db.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
  return { ok: true };
}

export const deleteAccountSchema = z.object({ password: z.string().max(200).optional(), confirmEmail: z.string().trim().max(320).optional() });

/** Suppression en base puis dans le stockage : commune à la suppression par l'étudiant et à celle décidée par l'administration. */
export async function purgeAccount(userId: string) {
  const [versions, imports] = await Promise.all([
    db.documentVersion.findMany({ where: { userId, storageKey: { not: null } }, select: { storageKey: true } }),
    db.scheduleImport.findMany({ where: { userId }, select: { storageKey: true } }),
  ]);
  await db.$transaction([
    // Tables historiques sans clé étrangère vers le compte : la suppression en cascade ne les atteint pas.
    db.programRun.deleteMany({ where: { userId } }),
    db.sqlQueryLog.deleteMany({ where: { userId } }),
    db.chatMessage.deleteMany({ where: { userId } }),
    db.user.delete({ where: { id: userId } }),
  ]);
  const keys = [...withPreviewKeys(versions.map((v) => v.storageKey!)), ...imports.map((i) => i.storageKey)];
  await getStorage().remove(keys).catch((e) => console.error("[account] fichiers non retirés du stockage :", e instanceof Error ? e.message : e));
}

/**
 * Suppression définitive : un compte à mot de passe confirme ce mot de passe, un compte Google recopie son adresse.
 * Les fichiers originaux sont retirés du stockage après la suppression en base, qui reste l'opération décisive.
 */
export async function deleteAccount(userId: string, input: z.infer<typeof deleteAccountSchema>) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiHttpError("Compte introuvable.", 404);
  if (hasPassword(user.passwordHash)) {
    if (!input.password || !verifyPassword(input.password, user.passwordHash)) throw new ApiHttpError("Mot de passe incorrect.", 403);
  } else if ((input.confirmEmail ?? "").toLowerCase() !== user.email.toLowerCase()) {
    throw new ApiHttpError("L'adresse saisie ne correspond pas à celle du compte.", 403);
  }
  await purgeAccount(userId);
  return { ok: true };
}

/** Copie lisible des données personnelles (les fichiers originaux restent téléchargeables depuis chaque matière). */
export async function exportAccount(userId: string) {
  const [profile, settings, subjects, documents, notes, exercises, attempts, tasks] = await Promise.all([
    getProfile(userId),
    db.userSettings.findUnique({ where: { userId }, select: { theme: true, textSize: true, exerciseLang: true, defaultMode: true, hintsEnabled: true, correctionPref: true, explanationLevel: true, notifyProgress: true, notifyRevision: true, notifyActivities: true, maxUploadMB: true } }),
    db.subject.findMany({ where: { userId }, select: { name: true, createdAt: true } }),
    db.document.findMany({ where: { userId }, select: { name: true, originalName: true, type: true, size: true, createdAt: true, subject: { select: { name: true } } } }),
    db.note.findMany({ where: { userId }, select: { title: true, kind: true, content: true, createdAt: true, updatedAt: true, subject: { select: { name: true } } } }),
    db.exercise.findMany({ where: { userId }, select: { title: true, origin: true, totalPoints: true, createdAt: true, subject: { select: { name: true } }, questions: { select: { position: true, type: true, points: true, payload: true } } } }),
    db.exerciseAttempt.findMany({ where: { userId }, select: { status: true, score: true, maxScore: true, startedAt: true, finishedAt: true, exercise: { select: { title: true } }, answers: { select: { position: true, value: true, verdict: true, points: true } } } }),
    db.academicTask.findMany({ where: { userId }, select: { title: true, description: true, type: true, status: true, dueDate: true } }),
  ]);
  const { auth: _auth, avatar: _avatar, ...identity } = profile;
  void _auth;
  void _avatar;
  return { exportedAt: new Date().toISOString(), profile: identity, preferences: settings, subjects, documents, notes, exercises, attempts, tasks };
}
