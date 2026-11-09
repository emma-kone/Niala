import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { requireSubject } from "@/server/services/folders";
import {
  annotationDoc,
  deriveKind,
  emptyNoteDoc,
  noteToText,
  parseNoteContent,
  snippet,
  NoteContentError,
  type NoteDoc,
} from "@/server/domain/note-content";

// ─────────────────────────────────────────────────────────────────────────────
// Notes unifiées : UN système pour les notes personnelles, les notes liées à un document,
// les annotations de passage et les fiches de synthèse. La nature (kind) est déduite des liens.
// ─────────────────────────────────────────────────────────────────────────────

export const anchorSchema = z.object({
  quote: z.string().min(1).max(1000),
  // Rectangles en unités PDF (échelle 1), relatifs à la page : permettent de resurligner le passage.
  rects: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive().finite(), h: z.number().positive().finite() }))
    .max(60)
    .optional(),
});
export type Anchor = z.infer<typeof anchorSchema>;

export const linkInputSchema = z.object({
  documentId: z.string().min(1),
  page: z.number().int().min(1).max(100_000).nullable().optional(),
  anchor: anchorSchema.nullable().optional(),
});
export type LinkInput = z.infer<typeof linkInputSchema>;

const noteInclude = {
  links: { include: { document: { select: { id: true, name: true } } }, orderBy: { id: "asc" } },
} satisfies Prisma.NoteInclude;

type NoteWithLinks = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

function linkDto(l: NoteWithLinks["links"][number]) {
  return {
    id: l.id,
    documentId: l.documentId,
    documentName: l.document.name,
    versionId: l.versionId,
    page: l.page,
    anchor: (l.anchor as Anchor | null) ?? null,
  };
}

function listItem(n: NoteWithLinks) {
  return {
    id: n.id,
    subjectId: n.subjectId,
    kind: n.kind,
    title: n.title,
    snippet: snippet(n.content),
    updatedAt: n.updatedAt,
    createdAt: n.createdAt,
    links: n.links.map(linkDto),
  };
}

function fullDto(n: NoteWithLinks) {
  return { ...listItem(n), content: n.content as unknown as NoteDoc, revision: n.revision };
}

function contentOrThrow(input: unknown): NoteDoc {
  try {
    return parseNoteContent(input);
  } catch (e) {
    if (e instanceof NoteContentError) throw new ApiHttpError(e.message, 422);
    throw e;
  }
}

/** Les documents liés doivent appartenir à l'utilisateur ET à la matière de la note. */
async function resolveDocuments(userId: string, subjectId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<string, { id: string; currentVersionId: string | null }>();
  const docs = await db.document.findMany({
    where: { id: { in: unique }, userId, subjectId },
    select: { id: true, currentVersionId: true },
  });
  if (docs.length !== unique.length) throw new ApiHttpError("Document introuvable dans cette matière.", 404);
  return new Map(docs.map((d) => [d.id, d]));
}

export interface ListFilter {
  subjectId: string;
  kind?: "PERSONAL" | "DOCUMENT" | "ANNOTATION" | "SUMMARY";
  documentId?: string;
  q?: string;
}

/** Toutes les notes de l'étudiant, regroupées par matière (matières sans note comprises). */
export async function listAllNotes(userId: string) {
  const subjects = await db.subject.findMany({ where: { userId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true, icon: true, notes: { where: { userId }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, title: true, updatedAt: true } } } });
  return { groups: subjects.map(({ notes, ...subject }) => ({ subject, notes })) };
}

export async function listNotes(userId: string, filter: ListFilter) {
  await requireSubject(userId, filter.subjectId);
  const notes = await db.note.findMany({
    where: {
      userId,
      subjectId: filter.subjectId,
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.documentId ? { links: { some: { documentId: filter.documentId, userId } } } : {}),
    },
    include: noteInclude,
    orderBy: { updatedAt: "desc" },
    take: 500,
  });
  const q = filter.q?.trim().toLowerCase();
  const kept = q
    ? notes.filter((n) => n.title.toLowerCase().includes(q) || noteToText(n.content as never).toLowerCase().includes(q))
    : notes;
  return kept.map(listItem);
}

export async function getNote(userId: string, id: string) {
  const note = await db.note.findFirst({ where: { id, userId }, include: noteInclude });
  if (!note) throw new ApiHttpError("Note introuvable.", 404);
  return fullDto(note);
}

export interface CreateNoteInput {
  subjectId: string;
  kind?: "PERSONAL" | "SUMMARY";
  title?: string;
  content?: unknown;
  links?: LinkInput[];
}

export async function createNote(userId: string, input: CreateNoteInput) {
  await requireSubject(userId, input.subjectId);
  const links = input.links ?? [];
  const docs = await resolveDocuments(userId, input.subjectId, links.map((l) => l.documentId));
  const firstQuote = links.find((l) => l.anchor?.quote)?.anchor?.quote;
  const content = input.content !== undefined ? contentOrThrow(input.content) : firstQuote ? annotationDoc(firstQuote) : emptyNoteDoc();
  const kind = deriveKind(input.kind ?? "PERSONAL", links.map((l) => ({ anchor: l.anchor ?? null })));

  const note = await db.note.create({
    data: {
      userId,
      subjectId: input.subjectId,
      kind,
      title: (input.title ?? "").trim().slice(0, 200),
      content: content as unknown as Prisma.InputJsonValue,
      links: {
        create: links.map((l) => ({
          userId,
          documentId: l.documentId,
          versionId: docs.get(l.documentId)!.currentVersionId,
          page: l.page ?? null,
          anchor: (l.anchor ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      },
    },
    include: noteInclude,
  });
  return fullDto(note);
}

/** Mise à jour avec contrôle de concurrence optimiste : `revision` doit être celle que le client a lue. */
export async function updateNote(userId: string, id: string, input: { revision: number; title?: string; content?: unknown }) {
  const data: Prisma.NoteUpdateManyMutationInput = { revision: { increment: 1 } };
  if (input.title !== undefined) data.title = input.title.trim().slice(0, 200);
  if (input.content !== undefined) data.content = contentOrThrow(input.content) as unknown as Prisma.InputJsonValue;

  const res = await db.note.updateMany({ where: { id, userId, revision: input.revision }, data });
  if (res.count === 0) {
    const current = await db.note.findFirst({ where: { id, userId }, select: { revision: true } });
    if (!current) throw new ApiHttpError("Note introuvable.", 404);
    throw new ApiHttpError("Cette note a été modifiée ailleurs. Rechargez-la pour éviter d'écraser ces changements.", 409, {
      currentRevision: current.revision,
    });
  }
  const note = await db.note.findFirstOrThrow({ where: { id, userId }, select: { revision: true, updatedAt: true } });
  return { revision: note.revision, updatedAt: note.updatedAt };
}

async function refreshKind(tx: Prisma.TransactionClient, userId: string, noteId: string) {
  const note = await tx.note.findFirstOrThrow({ where: { id: noteId, userId }, include: { links: { select: { anchor: true } } } });
  const kind = deriveKind(note.kind, note.links);
  if (kind !== note.kind) await tx.note.update({ where: { id: noteId }, data: { kind } });
}

export async function addLink(userId: string, noteId: string, link: LinkInput) {
  const note = await db.note.findFirst({ where: { id: noteId, userId }, select: { subjectId: true } });
  if (!note) throw new ApiHttpError("Note introuvable.", 404);
  const docs = await resolveDocuments(userId, note.subjectId, [link.documentId]);
  await db.$transaction(async (tx) => {
    await tx.noteLink.create({
      data: {
        userId,
        noteId,
        documentId: link.documentId,
        versionId: docs.get(link.documentId)!.currentVersionId,
        page: link.page ?? null,
        anchor: (link.anchor ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await refreshKind(tx, userId, noteId);
  });
  return getNote(userId, noteId);
}

export async function removeLink(userId: string, noteId: string, linkId: string) {
  const link = await db.noteLink.findFirst({ where: { id: linkId, noteId, userId } });
  if (!link) throw new ApiHttpError("Lien introuvable.", 404);
  await db.$transaction(async (tx) => {
    await tx.noteLink.delete({ where: { id: linkId } });
    await refreshKind(tx, userId, noteId);
  });
  return getNote(userId, noteId);
}

export async function deleteNote(userId: string, id: string) {
  const res = await db.note.deleteMany({ where: { id, userId } });
  if (res.count === 0) throw new ApiHttpError("Note introuvable.", 404);
  return { ok: true };
}
