export interface ChatCitation {
  n: number;
  documentId: string;
  documentName: string;
  subjectId: string | null;
  versionId: string;
  page: number | null;
  section: string | null;
  quote: string;
  kind?: "document" | "web";
  url?: string;
  tier?: "reconnue" | "a_verifier";
}

export interface ConsultedInfo {
  documents: { id: string; name: string }[];
  passages: number;
  webSources?: number;
  web?: boolean;
  pagesRead: number;
  tools: string[];
  coverage: { documentId: string; documentName: string; complete: boolean; warnings: string[] }[];
}

export interface ChatAttachmentDto {
  kind: "library" | "file" | "image";
  name: string;
  documentId?: string;
  truncated?: boolean;
}

export interface ChatMessageDto {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  attachments?: ChatAttachmentDto[];
  citations: ChatCitation[] | null;
  consulted: ConsultedInfo | null;
  model: string | null;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  title: string;
  scope: "GLOBAL" | "DOCUMENT";
  documentId: string | null;
  subjectId: string | null;
  updatedAt: string;
}
