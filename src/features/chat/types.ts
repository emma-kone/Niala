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
  /** Recherches web lancées pendant la réponse. */
  webSearches?: number;
  /** Fiabilité des sources web citées, calculée par le serveur (null : pas de recherche web). */
  webReliability?: "verifiee" | "non_verifiee" | "aucune" | "indisponible" | null;
  pagesRead: number;
  tools: string[];
  coverage: { documentId: string; documentName: string; complete: boolean; warnings: string[] }[];
}

export interface ChatMessageDto {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
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
