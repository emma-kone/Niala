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

// ── Markdown → document de note ──────────────────────────────────────────────
// Sert à l'assistant IA : il rédige en Markdown simple, le serveur construit un document valide pour l'éditeur.

const MAX_MD_CHARS = 20_000;

/** Texte en ligne : **gras**, *italique*, `code`. Le reste est du texte brut. */
function inlineNodes(text: string): NoteNode[] {
  const out: NoteNode[] = [];
  const pattern = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: text.slice(last, at) });
    const token = m[0];
    if (token.startsWith("**") || token.startsWith("__")) out.push({ type: "text", text: token.slice(2, -2), marks: [{ type: "bold" }] });
    else if (token.startsWith("`")) out.push({ type: "text", text: token.slice(1, -1), marks: [{ type: "code" }] });
    else out.push({ type: "text", text: token.slice(1, -1), marks: [{ type: "italic" }] });
    last = at + token.length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out.filter((n) => n.text);
}

const paragraph = (text: string): NoteNode => {
  const content = inlineNodes(text);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

/** Convertit un Markdown simple (titres, listes, citations, code, gras/italique) en blocs de note valides. */
export function markdownToNoteBlocks(markdown: string): NoteNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").slice(0, MAX_MD_CHARS).split("\n");
  const blocks: NoteNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```\s*([\w#+.-]{0,20})\s*$/.exec(line.trim());
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) body.push(lines[i++]);
      i++;
      blocks.push({ type: "codeBlock", attrs: { language: fence[1] || null }, content: body.length ? [{ type: "text", text: body.join("\n") }] : undefined });
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", attrs: { level: heading[1].length }, content: inlineNodes(heading[2].trim()) });
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      const items: NoteNode[] = [];
      while (i < lines.length && marker.test(lines[i])) {
        items.push({ type: "listItem", content: [paragraph(lines[i].replace(marker, "").trim())] });
        i++;
      }
      blocks.push({ type: ordered ? "orderedList" : "bulletList", ...(ordered ? { attrs: { start: 1 } } : {}), content: items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ type: "blockquote", content: [paragraph(quote.join(" ").trim())] });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      blocks.push({ type: "horizontalRule" });
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>\s?|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) para.push(lines[i++].trim());
    blocks.push(paragraph(para.join(" ")));
  }
  return blocks;
}

/** Ajoute des blocs à la suite d'un document de note, en laissant le contenu existant intact. */
export function appendBlocks(doc: NoteDoc, blocks: NoteNode[]): NoteDoc {
  const existing = doc.content.filter((n, idx, all) => !(n.type === "paragraph" && !n.content?.length && idx === all.length - 1 && all.length === 1));
  return { type: "doc", content: [...existing, ...blocks] };
}
