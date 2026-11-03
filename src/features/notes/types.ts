export type NoteKind = "PERSONAL" | "DOCUMENT" | "ANNOTATION" | "SUMMARY";

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  PERSONAL: "Note personnelle",
  DOCUMENT: "Note de document",
  ANNOTATION: "Annotation",
  SUMMARY: "Fiche de synthèse",
};

export interface NoteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NoteAnchor {
  quote: string;
  rects?: NoteRect[];
}

export interface NoteLinkDto {
  id: string;
  documentId: string;
  documentName: string;
  versionId: string | null;
  page: number | null;
  anchor: NoteAnchor | null;
}

export interface NoteListItem {
  id: string;
  subjectId: string;
  kind: NoteKind;
  title: string;
  snippet: string;
  updatedAt: string;
  createdAt: string;
  links: NoteLinkDto[];
}

export interface NoteDetail extends NoteListItem {
  content: Record<string, unknown>;
  revision: number;
}
