import { ApiHttpError } from "@/lib/api-helpers";
import { extractContent } from "@/lib/extraction";
import { detectKind, isImageKind, matchesSignature, mimeFor, sanitizeName, type DocKind } from "@/server/domain/file-validation";
import { wrapUntrusted } from "@/server/ai/guard";
import type { ChatPart } from "@/server/ai/provider";

// ─────────────────────────────────────────────────────────────────────────────
// Pièces jointes d'un message de chat. Trois sources :
//  - « library » : un document de la bibliothèque (consulté par les outils de recherche, donc cité) ;
//  - « file »    : un fichier de l'ordinateur, lu pour ce message (texte extrait, jamais ajouté à la bibliothèque) ;
//  - « image »   : une image transmise telle quelle au modèle (vision).
// Le contenu d'un fichier est toujours présenté au modèle comme DONNÉE non fiable.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_ATTACHMENTS = 4;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Texte conservé par fichier (au-delà : tronqué et signalé). */
export const MAX_TEXT_CHARS = 30_000;
/** Total de texte de pièces jointes rejoué depuis l'historique. */
const HISTORY_TEXT_BUDGET = 60_000;

export interface StoredAttachment {
  kind: "library" | "file" | "image";
  name: string;
  documentId?: string;
  /** Texte extrait (file). */
  text?: string;
  truncated?: boolean;
  /** Avertissements d'extraction. */
  warnings?: string[];
  /** Image : type MIME et contenu base64. */
  mime?: string;
  data?: string;
}

export interface AttachmentMeta {
  kind: StoredAttachment["kind"];
  name: string;
  documentId?: string;
  truncated?: boolean;
}

/** Vue sans contenu, pour l'affichage. */
export function attachmentMeta(raw: unknown): AttachmentMeta[] {
  return asStored(raw).map((a) => ({ kind: a.kind, name: a.name, ...(a.documentId ? { documentId: a.documentId } : {}), ...(a.truncated ? { truncated: true } : {}) }));
}

export function asStored(raw: unknown): StoredAttachment[] {
  return Array.isArray(raw) ? (raw.filter((a) => a && typeof a === "object" && typeof (a as StoredAttachment).name === "string") as StoredAttachment[]) : [];
}

/** Valide et lit les fichiers envoyés avec le message. */
export async function prepareFiles(files: File[]): Promise<StoredAttachment[]> {
  const out: StoredAttachment[] = [];
  for (const file of files) {
    const name = sanitizeName(file.name) || "fichier";
    const kind = detectKind(name);
    if (!kind) throw new ApiHttpError(`« ${name} » : format non pris en charge (PDF, Word, PowerPoint, texte, Markdown, PNG, JPEG, WebP).`, 415);
    const image = isImageKind(kind);
    if (file.size > (image ? MAX_IMAGE_BYTES : MAX_FILE_BYTES)) throw new ApiHttpError(`« ${name} » est trop volumineux (${image ? "5" : "10"} Mo maximum).`, 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!matchesSignature(kind, buffer.subarray(0, 4096))) throw new ApiHttpError(`« ${name} » : le contenu ne correspond pas à son extension.`, 422);
    if (image) {
      out.push({ kind: "image", name, mime: mimeFor(kind as DocKind), data: buffer.toString("base64") });
      continue;
    }
    let extracted;
    try {
      extracted = await extractContent(kind, buffer);
    } catch {
      throw new ApiHttpError(`« ${name} » n'a pas pu être lu.`, 422);
    }
    const text = extracted.text.trim();
    if (!text) throw new ApiHttpError(`« ${name} » ne contient aucun texte lisible (document scanné ? joignez-le plutôt comme image).`, 422);
    out.push({ kind: "file", name, text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS, warnings: extracted.meta.warnings.slice(0, 3) });
  }
  return out;
}

/** Parties d'un tour utilisateur : texte du message + contenu des pièces jointes. */
export function userParts(content: string, attachments: StoredAttachment[], opts: { images?: boolean; textBudget?: number } = {}): ChatPart[] {
  const withImages = opts.images !== false;
  let budget = opts.textBudget ?? Infinity;
  const head: string[] = [content];
  const images: ChatPart[] = [];
  const library = attachments.filter((a) => a.kind === "library");
  if (library.length) head.push(`[Documents de cours joints par l'étudiant — à consulter en priorité avec search_passages / read_pages : ${library.map((a) => `« ${a.name} » (document_id: ${a.documentId})`).join(" ; ")}]`);
  for (const a of attachments) {
    if (a.kind === "file" && a.text) {
      const text = a.text.slice(0, Math.max(0, budget));
      budget -= text.length;
      head.push(
        text
          ? `[Fichier joint : « ${a.name} »${a.truncated || text.length < a.text.length ? " — extrait tronqué, la fin n'est pas disponible" : ""}]\n${wrapUntrusted(`pièce jointe ${a.name}`, text)}`
          : `[Fichier joint : « ${a.name} » — contenu omis (historique trop long)]`
      );
    } else if (a.kind === "image") {
      if (withImages && a.data && a.mime) {
        head.push(`[Image jointe : « ${a.name} »]`);
        images.push({ inlineData: { mimeType: a.mime, data: a.data } });
      } else head.push(`[Image jointe plus tôt : « ${a.name} » — non rechargée]`);
    }
  }
  return [{ text: head.join("\n\n") }, ...images];
}

export { HISTORY_TEXT_BUDGET };
