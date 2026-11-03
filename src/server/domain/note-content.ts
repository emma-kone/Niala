// Contenu des notes : document JSON de l'éditeur riche (Tiptap/ProseMirror), validé et nettoyé
// côté serveur (liste blanche de nœuds, marques et attributs). Le client n'est jamais fiable.

import type { NoteKind } from "@prisma/client";

export interface NoteNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NoteNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export type NoteDoc = NoteNode & { type: "doc"; content: NoteNode[] };

export const MAX_NOTE_BYTES = 400_000;
const MAX_DEPTH = 24;
const MAX_NODES = 20_000;

const BLOCKS = new Set([
  "paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock",
  "horizontalRule", "table", "tableRow", "tableHeader", "tableCell", "hardBreak", "text",
]);
const MARKS = new Set(["bold", "italic", "strike", "underline", "code", "link"]);

export class NoteContentError extends Error {}

const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : fallback;

function cleanAttrs(type: string, attrs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const a = attrs ?? {};
  switch (type) {
    case "heading":
      return { level: int(a.level, 1, 4, 2) };
    case "orderedList":
      return { start: int(a.start, 1, 100_000, 1) };
    case "codeBlock":
      return { language: typeof a.language === "string" && /^[\w#+.-]{1,20}$/.test(a.language) ? a.language : null };
    case "tableHeader":
    case "tableCell":
      return { colspan: int(a.colspan, 1, 20, 1), rowspan: int(a.rowspan, 1, 200, 1) };
    default:
      return undefined;
  }
}

function safeHref(href: unknown): string | null {
  if (typeof href !== "string" || href.length > 2000) return null;
  try {
    const u = new URL(href);
    return ["http:", "https:", "mailto:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Valide et nettoie un document de note. Lève NoteContentError si la structure est inacceptable. */
export function parseNoteContent(input: unknown): NoteDoc {
  if (JSON.stringify(input ?? null).length > MAX_NOTE_BYTES) {
    throw new NoteContentError("La note est trop volumineuse.");
  }
  let count = 0;

  const walk = (raw: unknown, depth: number, isRoot = false): NoteNode => {
    if (depth > MAX_DEPTH) throw new NoteContentError("Note trop profondément imbriquée.");
    if (++count > MAX_NODES) throw new NoteContentError("Note trop complexe.");
    if (!raw || typeof raw !== "object") throw new NoteContentError("Contenu de note invalide.");
    const n = raw as Record<string, unknown>;
    const type = n.type;
    if (typeof type !== "string") throw new NoteContentError("Contenu de note invalide.");
    if (isRoot) {
      if (type !== "doc") throw new NoteContentError("Contenu de note invalide.");
    } else if (!BLOCKS.has(type)) {
      throw new NoteContentError(`Élément non pris en charge : ${type}.`);
    }

    const out: NoteNode = { type };
    const attrs = cleanAttrs(type, n.attrs as Record<string, unknown> | undefined);
    if (attrs) out.attrs = attrs;

    if (type === "text") {
      if (typeof n.text !== "string") throw new NoteContentError("Texte invalide.");
      out.text = n.text;
      if (Array.isArray(n.marks)) {
        const marks: NonNullable<NoteNode["marks"]> = [];
        for (const m of n.marks) {
          const mt = (m as { type?: unknown })?.type;
          if (typeof mt !== "string" || !MARKS.has(mt)) continue;
          if (mt === "link") {
            const href = safeHref((m as { attrs?: { href?: unknown } }).attrs?.href);
            if (href) marks.push({ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer nofollow" } });
          } else marks.push({ type: mt });
        }
        if (marks.length) out.marks = marks;
      }
      return out;
    }
    if (Array.isArray(n.content)) out.content = n.content.map((c) => walk(c, depth + 1));
    return out;
  };

  const doc = walk(input, 0, true) as NoteDoc;
  doc.content = doc.content ?? [];
  return doc;
}

export const emptyNoteDoc = (): NoteDoc => ({ type: "doc", content: [{ type: "paragraph" }] });

/** Document d'une annotation : le passage cité, puis un paragraphe vide pour le commentaire. */
export function annotationDoc(quote: string): NoteDoc {
  return {
    type: "doc",
    content: [
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: quote.slice(0, 1000) }] }] },
      { type: "paragraph" },
    ],
  };
}

/** Texte brut (recherche, aperçus). */
export function noteToText(node: NoteNode | null | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  const inner = (node.content ?? []).map(noteToText);
  const block = ["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow", "tableCell", "tableHeader"].includes(node.type);
  return block ? inner.join(node.type === "tableRow" ? " | " : "") + "\n" : inner.join("");
}

export function snippet(doc: unknown, max = 140): string {
  const t = noteToText(doc as NoteNode).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/**
 * Nature d'une note, déduite de ses liens (une seule source de vérité) :
 * ancrage précis → annotation ; fiche de synthèse → inchangée ; liée à au moins un document → note de document ;
 * sinon note personnelle.
 */
export function deriveKind(current: NoteKind, links: { anchor: unknown | null }[]): NoteKind {
  if (current === "SUMMARY") return "SUMMARY";
  if (links.some((l) => l.anchor != null)) return "ANNOTATION";
  return links.length > 0 ? "DOCUMENT" : "PERSONAL";
}
