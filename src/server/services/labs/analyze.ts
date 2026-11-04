import { createHash } from "node:crypto";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { transform } from "sucrase";
import { editorOnlyLanguage, languageOf } from "@/server/domain/lab-tests";
import {
  EXPLAINABLE,
  checkBrackets,
  explainSqlError,
  parsePythonCheck,
  parseSucraseError,
  pythonCheckProgram,
  splitSqlStatements,
  type CodeAnalysis,
  type CodeProblem,
} from "@/server/domain/code-analysis";
import { runCodeCases, runSqlCases, runnerAvailable } from "@/server/labs/runner/host";
import { sqlErrorReason } from "@/server/domain/lab-tests";

// ─────────────────────────────────────────────────────────────────────────────
// Analyse du code « en direct » : le code n'est JAMAIS exécuté. Les constats viennent d'outils :
//  - JavaScript / TypeScript : analyseur de syntaxe (en-processus, ne fait qu'analyser) ;
//  - Python : compile() dans le runner isolé ;
//  - SQL : EXPLAIN de chaque instruction sur le schéma de l'espace de travail ;
//  - autres langages : contrôle des délimiteurs seulement, annoncé comme tel.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CODE = 60_000;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: CodeAnalysis }>();

function remember(key: string, value: CodeAnalysis) {
  if (cache.size > 300) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  cache.set(key, { at: Date.now(), value });
  return value;
}

const LABEL: Record<string, string> = { c: "C", csharp: "C#" };

function finish(base: Omit<CodeAnalysis, "durationMs" | "summary">, started: number, forced?: CodeAnalysis["summary"]): CodeAnalysis {
  const hasError = base.problems.some((p) => p.severity === "error");
  const summary = forced ?? (!base.executable ? "not_executable" : hasError ? "syntax_error" : "ok");
  return { ...base, summary, durationMs: Date.now() - started };
}

export async function analyzeCode(userId: string, input: { language: string; content: string; workspaceId?: string }): Promise<CodeAnalysis> {
  const started = Date.now();
  if (input.content.length > MAX_CODE) throw new ApiHttpError("Code trop long pour l'analyse en direct.", 413);
  const exec = languageOf(input.language);
  const only = editorOnlyLanguage(input.language);
  const language = exec ?? only ?? input.language.toLowerCase();
  if (!input.content.trim()) return { language, executable: !!exec, verification: "none", summary: "empty", problems: [], durationMs: 0 };

  let schemaSql = "";
  if (language === "sql" && input.workspaceId) {
    const w = await db.labWorkspace.findFirst({ where: { id: input.workspaceId, userId }, select: { schemaSql: true, brief: true } });
    if (!w) throw new ApiHttpError("Espace de travail introuvable.", 404);
    schemaSql = (w.brief as { sql?: { setupSql?: string } } | null)?.sql?.setupSql ?? w.schemaSql ?? "";
  }
  const key = `${userId}:${language}:${createHash("sha1").update(input.content).update("\0").update(schemaSql).digest("hex")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  // Langages non exécutables : jamais de verdict de compilation, seulement l'équilibre des délimiteurs.
  if (!exec) {
    const problems: CodeProblem[] = only || ["java", "c", "cpp", "csharp"].includes(language) ? checkBrackets(input.content) : [];
    return remember(
      key,
      finish(
        {
          language,
          executable: false,
          executableReason: `${LABEL[language] ?? language.toUpperCase()} n'est pas exécutable dans Niala : aucun compilateur sûr n'est disponible et rien n'est simulé.`,
          verification: problems.length || only ? "form" : "none",
          problems,
        },
        started
      )
    );
  }

  const runner = runnerAvailable();

  if (language === "javascript" || language === "typescript") {
    const problems: CodeProblem[] = [];
    try {
      transform(input.content, { transforms: language === "typescript" ? ["typescript"] : [], disableESTransforms: true });
    } catch (e) {
      problems.push(parseSucraseError(e));
    }
    return remember(key, finish({ language, executable: runner.ok, executableReason: runner.ok ? undefined : `Exécution indisponible : ${runner.reason}`, verification: "compiler", problems }, started));
  }

  if (!runner.ok) {
    return finish({ language, executable: false, executableReason: `Exécution isolée indisponible : ${runner.reason}`, verification: "none", problems: [] }, started, "unavailable");
  }

  if (language === "python") {
    const r = await runCodeCases("python", pythonCheckProgram(input.content), [{ id: "chk" }], { totalBudgetMs: 25_000, caseTimeoutMs: 10_000 });
    if (r.unavailable || !r.results[0]) return finish({ language, executable: true, verification: "none", problems: [] }, started, "unavailable");
    const parsed = parsePythonCheck(r.results[0].stdout);
    if (parsed === null) return finish({ language, executable: true, verification: "none", problems: [] }, started, "unavailable");
    return remember(key, finish({ language, executable: true, verification: "compiler", problems: parsed === "ok" ? [] : [parsed] }, started));
  }

  // SQL
  const statements = splitSqlStatements(input.content);
  const explainable = statements.filter((s) => EXPLAINABLE.test(s.text));
  if (!explainable.length) return remember(key, finish({ language, executable: true, verification: "none", problems: [] }, started));
  const r = await runSqlCases([{ id: "chk", setupSql: schemaSql, script: explainable.map((s) => `EXPLAIN ${s.text}`).join(";\n"), readOnly: true }], { totalBudgetMs: 25_000, caseTimeoutMs: 10_000 });
  const res = r.results[0];
  if (r.unavailable || !res) return finish({ language, executable: true, verification: "none", problems: [] }, started, "unavailable");
  const err = res.user?.error ?? (res.status === "error" ? res.error : undefined);
  const problems: CodeProblem[] = [];
  if (err) {
    const failing = explainable[res.user?.statements.length ?? 0] ?? explainable[0];
    const reason = sqlErrorReason(err.message);
    problems.push({
      line: failing.line,
      severity: "error",
      kind: reason === "syntax" ? "syntax" : "structure",
      message: err.message,
      hint: explainSqlError(err.message),
      source: "sqlite",
    });
  }
  return remember(key, finish({ language, executable: true, verification: "compiler", problems }, started));
}
