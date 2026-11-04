// Validation des fichiers importés : extension autorisée + signature binaire cohérente.
// Un fichier dont le contenu ne correspond pas à son extension est refusé.

export const ACCEPTED_FORMATS = {
  pdf: { mime: "application/pdf", label: "PDF" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word (DOCX)" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint (PPTX)" },
  txt: { mime: "text/plain", label: "Texte" },
  md: { mime: "text/markdown", label: "Markdown" },
  png: { mime: "image/png", label: "Image PNG" },
  jpg: { mime: "image/jpeg", label: "Image JPEG" },
  webp: { mime: "image/webp", label: "Image WebP" },
} as const;

export type DocKind = keyof typeof ACCEPTED_FORMATS;

/** Images : leur texte est lu par l'IA (vision) ; l'original reste l'image elle-même. */
export const IMAGE_KINDS: readonly DocKind[] = ["png", "jpg", "webp"];
export const isImageKind = (k: string): boolean => (IMAGE_KINDS as readonly string[]).includes(k);

export const MAX_FILES_PER_IMPORT = 20;
export const MAX_UPLOAD_MB_CEILING = 50;

export function detectKind(filename: string): DocKind | null {
  let ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpeg") ext = "jpg";
  return ext in ACCEPTED_FORMATS ? (ext as DocKind) : null;
}

export function mimeFor(kind: DocKind): string {
  return ACCEPTED_FORMATS[kind].mime;
}

/** Nom d'affichage sûr : pas de chemin, pas de caractères de contrôle, longueur bornée. */
export function sanitizeName(raw: string, max = 120): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, max);
}

/** Vérifie la signature binaire. PDF : %PDF- ; DOCX/PPTX : archive ZIP (PK) ; texte : pas d'octet nul. */
export function matchesSignature(kind: DocKind, head: Uint8Array): boolean {
  if (head.length === 0) return false;
  switch (kind) {
    case "pdf": {
      // %PDF- peut être précédé de quelques octets (tolérance de la spécification : 1024)
      const text = Buffer.from(head.subarray(0, 1024)).toString("latin1");
      return text.includes("%PDF-");
    }
    case "docx":
    case "pptx":
      return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5) && (head[3] === 4 || head[3] === 6);
    case "png":
      return head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    case "jpg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "webp":
      return head.length >= 12 && Buffer.from(head.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(head.subarray(8, 12)).toString("latin1") === "WEBP";
    case "txt":
    case "md":
      return !head.subarray(0, 4096).includes(0);
  }
}
