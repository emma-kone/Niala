import { z } from "zod";
import { db } from "@/lib/db";
import { softDelete } from "@/lib/soft-delete";
import { requireUser } from "@/lib/auth";
import { handle, readJson, ApiHttpError } from "@/lib/api-helpers";
import { normalizeSubjectName } from "@/lib/subjects";
import { SUBJECT_ICON_IDS, suggestSubjectIcon } from "@/server/domain/subject-icon";
import { getStorage, withPreviewKeys } from "@/server/storage";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.enum(SUBJECT_ICON_IDS).nullable().optional(),
});

async function findOwnedSubject(id: string, userId: string) {
  const subject = await db.subject.findFirst({ where: { id, userId } });
  if (!subject) throw new ApiHttpError("Matière introuvable.", 404);
  return subject;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const subject = await findOwnedSubject(id, user.id);
    // Détail des conséquences avant suppression éventuelle
    const [chapterCount, docCount, exerciseCount, sessionCount] = await Promise.all([
      db.chapter.count({ where: { subjectId: id } }),
      db.document.count({ where: { subjectId: id } }),
      db.legacyExercise.count({ where: { subjectId: id } }),
      db.session.count({ where: { subjectId: id } }),
    ]);
    return {
      subject,
      consequences: { chapters: chapterCount, documents: docCount, exercises: exerciseCount, sessions: sessionCount },
    };
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const data = patchSchema.parse(await readJson<unknown>(req));
    const subject = await findOwnedSubject(id, user.id);
    const name = data.name?.trim().replace(/\s+/g, " ") ?? subject.name;

    if (data.name !== undefined) {
      const siblings = await db.subject.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
      const dup = siblings.find((s) => s.id !== id && normalizeSubjectName(s.name) === normalizeSubjectName(name));
      if (dup) throw new ApiHttpError(`Une matière nommée « ${dup.name} » existe déjà.`, 409);
    }
    // Une icône choisie par l'étudiant ne change plus d'elle-même ; null redonne la main à la déduction automatique.
    const auto = data.icon === undefined ? subject.iconAuto : data.icon === null;
    const icon = auto ? suggestSubjectIcon(name) : (data.icon ?? subject.icon);
    return { subject: await db.subject.update({ where: { id }, data: { ...data, name, icon, iconAuto: auto } }) };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await ctx.params;
    const subject = await findOwnedSubject(id, user.id);

    // Conséquences calculées côté serveur : l'interface les présente AVANT suppression.
    const [chapterCount, docCount, exerciseCount, sessionCount] = await Promise.all([
      db.chapter.count({ where: { subjectId: id } }),
      db.document.count({ where: { subjectId: id } }),
      db.legacyExercise.count({ where: { subjectId: id } }),
      db.session.count({ where: { subjectId: id } }),
    ]);

    // La suppression reste explicite : elle n'est exécutée que si le client
    // confirme avoir présenté les conséquences (confirmDelete=true).
    const url = new URL(_req.url);
    if (url.searchParams.get("confirmDelete") !== "true") {
      return {
        requiresConfirmation: true,
        consequences: {
          chapters: chapterCount,
          documents: docCount,
          exercises: exerciseCount,
          sessions: sessionCount,
        },
      };
    }

    // Les documents de la matière sont supprimés avec leurs fichiers originaux
    // (sinon ils resteraient orphelins dans le stockage).
    const docs = await db.document.findMany({
      where: { subjectId: id, userId: user.id },
      select: { id: true, versions: { select: { storageKey: true } } },
    });
    // Suppression douce : la matière et ses contenus disparaissent pour l'étudiant mais restent en base pour les statistiques.
    await db.$transaction(async (tx) => {
      await tx.learningActivity.deleteMany({ where: { userId: user.id, refType: "document", refId: { in: docs.map((d) => d.id) } } });
      await softDelete(tx, "Document", { id: { in: docs.map((d) => d.id) }, userId: user.id });
      await softDelete(tx, "Subject", { id, userId: user.id });
    });
    const keys = docs.flatMap((d) => d.versions.map((v) => v.storageKey).filter((k): k is string => !!k));
    await getStorage().remove(withPreviewKeys(keys)).catch((e) => console.error("[storage] suppression partielle", e));
    return { ok: true, deleted: subject.name };
  });
}
