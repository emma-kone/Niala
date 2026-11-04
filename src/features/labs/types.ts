export type LabKind = "CODE" | "SQL";

export interface LabListItem {
  id: string;
  kind: LabKind;
  mode: "FREE" | "EXERCISE";
  title: string;
  subjectId: string | null;
  subjectName: string | null;
  language?: string;
  updatedAt: string;
  lastResult: { passed: number; total: number; allPassed: boolean } | null;
}

export interface LabBrief {
  origin: "manual" | "question" | "document";
  statement: string;
  language?: string;
  starter?: string;
  verified: boolean;
  criteria?: string[];
  source?: { documentId?: string; documentName?: string; quote?: string; page?: number | null; exerciseId?: string; position?: number };
  revealedAt?: string;
  reference?: string;
  tests: { name: string; edge: boolean; hidden: boolean; stdin?: string; call?: { fn: string; args: unknown[] }; expected?: unknown }[];
  sql?: { ordered: boolean; variants: string[]; setupSql: string; checks: number };
}

export interface LabWorkspaceDto {
  id: string;
  kind: LabKind;
  mode: "FREE" | "EXERCISE";
  title: string;
  subjectId: string | null;
  exerciseId: string | null;
  files: { name: string; language: string; content: string }[];
  schemaSql: string | null;
  brief: LabBrief | null;
  runCount?: number;
  canReveal?: boolean;
  lastResult?: { passed: number; total: number; allPassed: boolean } | null;
}

export interface TestOutcome {
  id: string;
  name: string;
  edge: boolean;
  hidden: boolean;
  status: "pass" | "fail" | "error" | "timeout" | "not_run";
  message?: string;
  reason?: string;
  expected?: unknown;
  actual?: unknown;
  stdout?: string;
}

export interface Diagnosis {
  category: string;
  kind: string;
  confidence: number;
  label: string;
  tests: string[];
}

export interface TestSummary {
  passed: number;
  total: number;
  ratio: number;
  edgePassed: number;
  edgeTotal: number;
  allPassed: boolean;
}

export interface TestsBlock {
  outcomes: TestOutcome[];
  summary: TestSummary;
  diagnoses: Diagnosis[];
}

export interface SqlStatement {
  sql: string;
  columns?: string[];
  rows?: unknown[][];
  rowCount?: number;
  changes?: number;
}

export interface RunOutput {
  kind: "code" | "sql";
  status?: string;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  durationMs?: number;
  error?: { type: string; message: string; line?: number };
  statements?: SqlStatement[];
  schema?: { name: string; columns: { name: string; type: string; notNull: boolean; pk: boolean }[]; foreignKeys: { from: string; table: string; to: string }[] }[];
}

export interface RunDto {
  id: string;
  createdAt?: string;
  mode: "run" | "tests";
  output: RunOutput;
  tests: TestsBlock | null;
  diagnoses: Diagnosis[];
}

export interface RunHistoryItem {
  id: string;
  createdAt: string;
  mode: string;
  content: string;
  summary: TestSummary | null;
  output: RunOutput;
  tests: TestsBlock | null;
}

export const CATEGORY_LABEL: Record<string, string> = {
  SYNTAX: "Syntaxe",
  LOGIC: "Logique / exécution",
  CONCEPT: "Notion à revoir",
  METHOD: "Méthode",
  INSTRUCTION: "Consigne",
  FORGETTING: "Oubli",
  CARELESS: "Étourderie",
};
