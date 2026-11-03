export type Origin = "DOCUMENT" | "AI_INFERRED" | "USER";
export type RelationType = "PREREQUISITE" | "PART_OF" | "EXAMPLE_OF" | "DEFINES" | "CONTRASTS" | "RELATED";

export const RELATION_LABEL: Record<RelationType, string> = {
  PREREQUISITE: "est un prérequis de",
  PART_OF: "fait partie de",
  EXAMPLE_OF: "est un exemple de",
  DEFINES: "définit",
  CONTRASTS: "s'oppose à",
  RELATED: "est lié à",
};

export const ORIGIN_LABEL: Record<Origin, string> = {
  DOCUMENT: "Dans le document",
  AI_INFERRED: "Déduit par l'IA",
  USER: "Ajouté par vous",
};

export interface MapNodeDto {
  id: string;
  label: string;
  x: number;
  y: number;
  origin: Origin;
  conceptId: string | null;
  sectionId: string | null;
  data: { note?: string; edited?: boolean; page?: number | null; definition?: string } | null;
}

export interface MapEdgeDto {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  label: string | null;
  origin: Origin;
}

export interface MapDetail {
  id: string;
  subjectId: string;
  title: string;
  kind: "STRUCTURE" | "CONCEPT";
  revision: number;
  updatedAt: string;
  document: { id: string; name: string } | null;
  nodes: MapNodeDto[];
  edges: MapEdgeDto[];
  revisions: { number: number; createdAt: string }[];
}

export interface MapListItem {
  id: string;
  title: string;
  kind: "STRUCTURE" | "CONCEPT";
  updatedAt: string;
  nodes: number;
  edges: number;
  document: { id: string; name: string } | null;
}
