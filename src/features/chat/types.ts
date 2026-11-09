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
  level?: 1 | 2 | 3 | 4;
  sourceKind?: string;
  organization?: string | null;
  publishedAt?: string | null;
  retrievedAt?: string;
}

export type ClaimConfidence = "elevee" | "moderee" | "faible" | "non_verifiee" | "contradictoire";

export interface VerifiedClaimDto {
  text: string;
  type: string;
  domain: string;
  confidence: ClaimConfidence;
  basis: "web" | "document" | "aucune";
  reason: string;
  limits: string[];
  courseConflict: boolean;
  evidence: { n: number; stance: "soutient" | "contredit"; quote: string; direct: boolean }[];
}

export interface VerificationDto {
  status: "effectuee" | "ignoree" | "echec" | "en_cours";
  webStatus: "utilisee" | "indisponible" | "non_utilisee" | "desactivee";
  claims: VerifiedClaimDto[];
  summary: { elevee: number; moderee: number; faible: number; non_verifiee: number; contradictoire: number; document: number };
  rejectedCitations: number;
  limits: string[];
  checkedAt: string;
}

export interface ConsultedInfo {
  documents: { id: string; name: string }[];
  passages: number;
  webSources?: number;
  web?: boolean;
  /** Recherches web lancées pendant la réponse. */
  webSearches?: number;
  /** Vérification serveur de la réponse, affirmation par affirmation. */
  verification?: VerificationDto;
  pagesRead: number;
  tools: string[];
  /** La rédaction a été interrompue par l'étudiant : le texte est incomplet. */
  interrupted?: boolean;
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
