import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson, ApiHttpError } from "@/lib/api-helpers";
import { normalizeSubjectName } from "@/lib/subjects";
import { getStorage } from "@/server/storage";

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
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

    if (data.name !== undefined) {
      const cleanName = data.name.trim().replace(/\s+/g, " ");
      const siblings = await db.subject.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
      const dup = siblings.find((s) => s.id !== id && normalizeSubjectName(s.name) === normalizeSubjectName(cleanName));
      if (dup) throw new ApiHttpError(`Une matière nommée « ${dup.name} » existe déjà.`, 409);
      return { subject: await db.subject.update({ where: { id }, data: { ...data, name: cleanName } }) };
    }
    return { subject: await db.subject.update({ where: { id }, data }) };
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
    await db.$transaction([
      db.learningActivity.deleteMany({ where: { userId: user.id, refType: "document", refId: { in: docs.map((d) => d.id) } } }),
      db.document.deleteMany({ where: { id: { in: docs.map((d) => d.id) }, userId: user.id } }),
      db.subject.delete({ where: { id } }),
    ]);
    const keys = docs.flatMap((d) => d.versions.map((v) => v.storageKey).filter((k): k is string => !!k));
    await getStorage().remove(keys).catch((e) => console.error("[storage] suppression partielle", e));
    return { ok: true, deleted: subject.name };
  });
}
