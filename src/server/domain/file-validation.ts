// Validation des fichiers importés : extension autorisée + signature binaire cohérente.
// Un fichier dont le contenu ne correspond pas à son extension est refusé.

export const ACCEPTED_FORMATS = {
  pdf: { mime: "application/pdf", label: "PDF" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word (DOCX)" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint (PPTX)" },
  txt: { mime: "text/plain", label: "Texte" },
  md: { mime: "text/markdown", label: "Markdown" },
} as const;

export type DocKind = keyof typeof ACCEPTED_FORMATS;

export const MAX_FILES_PER_IMPORT = 20;
export const MAX_UPLOAD_MB_CEILING = 50;

export function detectKind(filename: string): DocKind | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
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
    case "txt":
    case "md":
      return !head.subarray(0, 4096).includes(0);
  }
}
