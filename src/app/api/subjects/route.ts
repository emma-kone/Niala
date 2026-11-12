import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle, readJson, ApiHttpError } from "@/lib/api-helpers";
import { normalizeSubjectName } from "@/lib/subjects";
import { SUBJECT_ICON_IDS, suggestSubjectIcon } from "@/server/domain/subject-icon";

const subjectSchema = z.object({
  name: z.string().min(1, "Nom requis").max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur hex invalide").optional(),
  icon: z.enum(SUBJECT_ICON_IDS).nullable().optional(),
});


export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const subjects = await db.subject.findMany({
      where: { userId: user.id },
      include: {
        chapters: {
          orderBy: { position: "asc" },
          include: { _count: { select: { documents: { where: { deletedAt: null } } } } },
        },
        _count: { select: { documents: { where: { deletedAt: null } }, exercises: true, sessions: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    // Matières créées avant les icônes : l'icône déduite est enregistrée une fois pour toutes, à partir de la liste
    // déjà lue (auparavant une lecture de plus à chaque appel, avant la liste).
    const missing = subjects.filter((s) => s.icon === null);
    if (missing.length) {
      await Promise.all(missing.map((s) => db.subject.updateMany({ where: { id: s.id, userId: user.id }, data: { icon: suggestSubjectIcon(s.name) } })));
      for (const s of missing) s.icon = suggestSubjectIcon(s.name);
    }
    return { subjects };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const data = subjectSchema.parse(await readJson<unknown>(req));

    // Prévention des doublons accidentels (nom normalisé).
    // Deux matières volontairement distinctes restent possibles via une
    // différenciation explicite du nom (ex. « Algorithmique — S1 » vs « S2 »).
    const existing = await db.subject.findMany({ where: { userId: user.id }, select: { id: true, name: true } });
    const dup = existing.find((s) => normalizeSubjectName(s.name) === normalizeSubjectName(data.name));
    if (dup) {
      throw new ApiHttpError(
        `Une matière nommée « ${dup.name} » existe déjà. Choisissez un autre nom ou renommez l'existante.`,
        409,
        { duplicateOf: dup.id },
      );
    }

    const subject = await db.subject.create({
      data: {
        userId: user.id,
        name: data.name.trim().replace(/\s+/g, " "),
        color: data.color ?? "#8b5cf6",
        icon: data.icon ?? suggestSubjectIcon(data.name),
        iconAuto: !data.icon,
      },
      include: {
        chapters: { orderBy: { position: "asc" }, include: { _count: { select: { documents: { where: { deletedAt: null } } } } } },
        _count: { select: { documents: { where: { deletedAt: null } }, exercises: true, sessions: true } },
      },
    });
    return { subject };
  });
}
