export interface FolderDto {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  documentCount: number;
  folderCount: number;
  updatedAt: string;
}

export interface DocumentDto {
  id: string;
  name: string;
  originalName: string;
  kind: string;
  mime: string;
  size: number;
  pageCount: number | null;
  status: "PENDING" | "PROCESSING" | "READY" | "PARTIAL" | "FAILED" | "UNSUPPORTED";
  warnings: string[];
  originalMissing: boolean;
  folderId: string | null;
  folderPath: string;
  versionNumber: number;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

export interface ExplorerResponse {
  subject: { id: string; name: string; color: string };
  folderId: string | null;
  path: { id: string; name: string }[];
  folders: FolderDto[];
  documents: DocumentDto[];
  searching: boolean;
  tree: { id: string; parentId: string | null; name: string }[];
  totals: { documents: number; folders: number };
}

export interface DocumentDetails extends DocumentDto {
  subjectId: string | null;
  lastPage: number | null;
  sha256: string | null;
  extractError: string | null;
  indexedPassages: number;
  versions: { id: string; number: number; size: number; createdAt: string; status: string; originalMissing: boolean }[];
}

export const STATUS_LABEL: Record<DocumentDto["status"], { label: string; tone: "ok" | "warn" | "bad" | "busy" }> = {
  PENDING: { label: "En attente", tone: "busy" },
  PROCESSING: { label: "Traitement…", tone: "busy" },
  READY: { label: "Prêt", tone: "ok" },
  PARTIAL: { label: "Partiel", tone: "warn" },
  UNSUPPORTED: { label: "Sans texte", tone: "warn" },
  FAILED: { label: "Échec", tone: "bad" },
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
