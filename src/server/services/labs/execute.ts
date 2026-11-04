import {
  classify,
  codeCasesFor,
  languageOf,
  EDITOR_ONLY_LANGUAGES,
  outcomeOfCode,
  outcomeOfSql,
  sqlCasesFor,
  summarize,
  type CodeTest,
  type Diagnosis,
  type SqlSpec,
  type TestOutcome,
  type TestSummary,
} from "@/server/domain/lab-tests";
import { runCodeCases, runSqlCases, runnerAvailable, type CodeCaseResult, type RunLimits, type SqlCaseResult, type SqlScriptOutcome } from "@/server/labs/runner/host";

// ─────────────────────────────────────────────────────────────────────────────
// Exécution pédagogique : exécution libre, exécution contre des tests objectifs, et validation
// d'une solution de référence (une question n'est « exécutable » que si sa référence passe ses tests).
// ─────────────────────────────────────────────────────────────────────────────

export type ExecLanguage = "javascript" | "typescript" | "python" | "sql";

export const LANGUAGES: { id: ExecLanguage; label: string }[] = [
  { id: "python", label: "Python 3 (Pyodide)" },
  { id: "javascript", label: "JavaScript (QuickJS)" },
  { id: "typescript", label: "TypeScript (transpilé, QuickJS)" },
  { id: "sql", label: "SQL (SQLite)" },
];

export const execLanguage = (l: string) => languageOf(l);

export function capabilities() {
  const a = runnerAvailable();
  return {
    available: a.ok,
    reason: a.reason,
    languages: LANGUAGES,
    /** Éditeur seul : coloration et saisie, aucune exécution. */
    editorOnly: EDITOR_ONLY_LANGUAGES,
    note: "C et C# s'écrivent dans l'éditeur (coloration) mais ne sont pas exécutables ici : aucun compilateur sûr n'est disponible, et rien n'est jamais simulé. Java, C++… ne sont pas proposés.",
  };
}

export interface FreeCodeRun {
  unavailable?: string;
  result?: CodeCaseResult;
  startupMs: number;
}

export async function runCodeFree(language: "javascript" | "typescript" | "python", code: string, stdin: string | undefined, limits?: Partial<RunLimits>): Promise<FreeCodeRun> {
  const r = await runCodeCases(language, code, [{ id: "free", stdin }], { totalBudgetMs: 30_000, ...limits });
  return { unavailable: r.unavailable, result: r.results[0], startupMs: r.startupMs };
}

export interface TestRun {
  unavailable?: string;
  outcomes: TestOutcome[];
  summary: TestSummary;
  diagnoses: Diagnosis[];
  /** Détail de la première erreur d'exécution (pour l'affichage de la trace). */
  firstError?: { type: string; message: string; line?: number };
  /** Sortie standard du premier test (utile pour comprendre). */
  stdout?: string;
}

export async function runCodeTests(language: "javascript" | "typescript" | "python", code: string, tests: CodeTest[], limits?: Partial<RunLimits>): Promise<TestRun> {
  const cases = codeCasesFor(tests);
  const r = await runCodeCases(language, code, cases, { caseTimeoutMs: 4000, totalBudgetMs: 45_000, ...limits });
  const outcomes = tests.map((t, i) => outcomeOfCode(t, cases[i].id, r.results[i]));
  const firstErr = r.results.find((x) => x?.error && x.status === "error")?.error;
  return { unavailable: r.unavailable, outcomes, summary: summarize(outcomes), diagnoses: classify(outcomes), firstError: firstErr, stdout: r.results[0]?.stdout?.slice(0, 2000) };
}

export interface SqlTestRun extends TestRun {
  schema: SqlScriptOutcome["schema"];
  /** Résultat visible du script étudiant sur le jeu de données de l'énoncé. */
  statements: SqlScriptOutcome["statements"];
  userError?: { type: string; message: string };
}

export async function runSqlTests(spec: SqlSpec, script: string, opts: { readOnly?: boolean } = {}, limits?: Partial<RunLimits>): Promise<SqlTestRun> {
  const cases = sqlCasesFor(spec, script, opts);
  const r = await runSqlCases(
    cases.map(({ edge: _e, name: _n, ...c }) => c),
    { caseTimeoutMs: 4000, totalBudgetMs: 45_000, ...limits },
  );
  const outcomes = cases.map((c, i) => outcomeOfSql(spec, c, r.results[i] as SqlCaseResult | undefined));
  const base = r.results[0] as SqlCaseResult | undefined;
  return {
    unavailable: r.unavailable,
    outcomes,
    summary: summarize(outcomes),
    diagnoses: classify(outcomes),
    schema: base?.expected?.schema ?? base?.user?.schema ?? [],
    statements: base?.user?.statements ?? [],
    userError: base?.user?.error,
  };
}

export async function runSqlFree(setupSql: string, script: string, readOnly = false, limits?: Partial<RunLimits>) {
  const r = await runSqlCases([{ id: "free", setupSql, script, readOnly }], { totalBudgetMs: 30_000, ...limits });
  return { unavailable: r.unavailable, result: r.results[0] as SqlCaseResult | undefined, startupMs: r.startupMs };
}

// ── Validation d'une solution de référence ───────────────────────────────────

/**
 * Exécute la référence contre les tests proposés : seuls les tests qu'elle réussit sont conservés
 * (un test faux ne doit jamais pénaliser l'étudiant). Renvoie null si le moteur est indisponible.
 */
export async function verifyCodeReference(language: "javascript" | "typescript" | "python", reference: string, tests: CodeTest[]): Promise<{ tests: CodeTest[]; dropped: number } | null> {
  if (tests.length === 0) return { tests: [], dropped: 0 };
  const run = await runCodeTests(language, reference, tests, { caseTimeoutMs: 4000 });
  if (run.unavailable) return null;
  const kept = tests.filter((_, i) => run.outcomes[i].status === "pass");
  return { tests: kept, dropped: tests.length - kept.length };
}

export async function verifySqlSpec(spec: SqlSpec): Promise<{ spec: SqlSpec; dropped: number; baseOk: boolean } | null> {
  const run = await runSqlTests(spec, spec.referenceSql);
  if (run.unavailable) return null;
  const baseOk = run.outcomes[0]?.status === "pass";
  if (!baseOk) return { spec, dropped: spec.variants.length, baseOk: false };
  const keptVariants = spec.variants.filter((_, i) => run.outcomes[i + 1]?.status === "pass");
  return { spec: { ...spec, variants: keptVariants }, dropped: spec.variants.length - keptVariants.length, baseOk: true };
}
