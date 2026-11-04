import { z } from "zod";
import type { ErrorCategory, LabKind, LabMode, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { assertFound } from "@/lib/ownership";
import { classify, editorOnlyLanguage, languageOf, parseCodeTests, sqlErrorReason, sqlSpecSchema, type CodeTest, type Diagnosis, type SqlSpec, type TestOutcome, type TestSummary } from "@/server/domain/lab-tests";
import type { CodeCaseResult } from "@/server/labs/runner/host";
import { SQL_FIXTURES } from "@/server/labs/fixtures";
import { capabilities, runCodeFree, runCodeTests, runSqlFree, runSqlTests } from "./execute";
import { generateHint, type HintLevel } from "./hints";
import { extractLabExercises } from "./import";
import { refreshProgress } from "@/server/services/progress/progress";

// ─────────────────────────────────────────────────────────────────────────────
// Laboratoires code & SQL : espaces de travail libres ou d'exercice, exécution isolée, tests objectifs,
// diagnostic d'erreurs, indices progressifs. Tout est filtré par propriétaire (404 sinon).
// La solution de référence ne quitte jamais le serveur avant d'être légitimement révélée.
// ─────────────────────────────────────────────────────────────────────────────

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const MAX_CODE = 40_000;

export interface Brief {
  origin: "manual" | "question" | "document";
  statement: string;
  language?: string;
  starter?: string;
  tests?: CodeTest[];
  sql?: SqlSpec;
  /** Les tests ont été validés en exécutant la solution de référence. */
  verified: boolean;
  reference?: string;
  criteria?: string[];
  source?: { documentId?: string; documentName?: string; versionId?: string; quote?: string; page?: number | null; exerciseId?: string; position?: number };
  revealedAt?: string;
}

interface FileJson {
  name: string;
  language: string;
  content: string;
}

const fileSchema = z.object({ name: text(60), language: text(20), content: z.string().max(MAX_CODE) });

const DEFAULT_FILE: Record<string, { name: string; content: string }> = {
  python: { name: "main.py", content: "# Écrivez votre code Python ici\nprint('Bonjour')\n" },
  javascript: { name: "main.js", content: "// Écrivez votre code JavaScript ici\nconsole.log('Bonjour');\n" },
  typescript: { name: "main.ts", content: "// Écrivez votre code TypeScript ici\nconst message: string = 'Bonjour';\nconsole.log(message);\n" },
  sql: { name: "requete.sql", content: "-- Écrivez votre requête ici\nSELECT 1;\n" },
  // Éditeur seul (aucune exécution) : modèles de départ
  c: { name: "main.c", content: '#include <stdio.h>\n\nint main(void) {\n    printf("Bonjour\\n");\n    return 0;\n}\n' },
  csharp: { name: "Program.cs", content: 'using System;\n\nclass Program\n{\n    static void Main()\n    {\n        Console.WriteLine("Bonjour");\n    }\n}\n' },
};

// ── DTO : jamais de référence, jamais de test caché ni de contrôle serveur ───────
function publicBrief(b: Brief | null, includeReference = false) {
  if (!b) return null;
  return {
    origin: b.origin,
    statement: b.statement,
    language: b.language,
    starter: b.starter,
    verified: b.verified,
    criteria: b.criteria,
    source: b.source,
    revealedAt: b.revealedAt,
    tests: (b.tests ?? []).map((t) => ({ name: t.name, edge: t.edge, hidden: t.hidden, stdin: t.hidden ? undefined : t.stdin, call: t.hidden ? undefined : t.call, expected: t.hidden ? undefined : t.expected })),
    sql: b.sql ? { ordered: b.sql.ordered, variants: b.sql.variants.map((v) => v.name), setupSql: b.sql.setupSql, checks: b.sql.checks.length } : undefined,
    ...(includeReference ? { reference: b.reference } : {}),
  };
}

type WorkspaceRow = Prisma.LabWorkspaceGetPayload<object>;

function toDto<E extends Record<string, unknown> = Record<string, never>>(w: WorkspaceRow, extra?: E) {
  const brief = (w.brief as unknown as Brief | null) ?? null;
  return {
    id: w.id,
    kind: w.kind,
    mode: w.mode,
    title: w.title,
    subjectId: w.subjectId,
    exerciseId: w.exerciseId,
    files: w.files as unknown as FileJson[],
    schemaSql: w.schemaSql,
    brief: publicBrief(brief, !!brief?.revealedAt),
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    ...(extra as E),
  };
}

async function owned(userId: string, id: string) {
  return assertFound(await db.labWorkspace.findFirst({ where: { id, userId } }), "Espace de travail");
}

async function checkSubject(userId: string, subjectId: string | null | undefined) {
  if (!subjectId) return null;
  assertFound(await db.subject.findFirst({ where: { id: subjectId, userId }, select: { id: true } }), "Matière");
  return subjectId;
}

async function touchActivity(userId: string, w: { id: string; kind: LabKind; title: string; subjectId: string | null }, done: boolean) {
  const where = { userId, refType: "lab", refId: w.id };
  const existing = await db.learningActivity.findFirst({ where });
  const data = { status: done ? ("DONE" as const) : ("IN_PROGRESS" as const), title: w.title.slice(0, 160) };
  if (existing) await db.learningActivity.update({ where: { id: existing.id }, data });
  else await db.learningActivity.create({ data: { userId, subjectId: w.subjectId, type: w.kind === "CODE" ? "LAB_CODE" : "LAB_SQL", refType: "lab", refId: w.id, ...data } });
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function labCapabilities() {
  return { ...capabilities(), fixtures: Object.entries(SQL_FIXTURES).map(([id, f]) => ({ id, label: f.label, description: f.description })) };
}

export async function listWorkspaces(userId: string, f: { kind?: LabKind; subjectId?: string; mode?: LabMode }) {
  const rows = await db.labWorkspace.findMany({
    where: { userId, ...(f.kind ? { kind: f.kind } : {}), ...(f.subjectId ? { subjectId: f.subjectId } : {}), ...(f.mode ? { mode: f.mode } : {}) },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { subject: { select: { name: true } }, runs: { orderBy: { createdAt: "desc" }, take: 1, select: { tests: true, createdAt: true } } },
  });
  return rows.map((w) => {
    const sum = (w.runs[0]?.tests as { summary?: TestSummary } | null)?.summary;
    return { id: w.id, kind: w.kind, mode: w.mode, title: w.title, subjectId: w.subjectId, subjectName: w.subject?.name ?? null, language: (w.files as unknown as FileJson[])[0]?.language, updatedAt: w.updatedAt, lastResult: sum ? { passed: sum.passed, total: sum.total, allPassed: sum.allPassed } : null };
  });
}

const createFreeSchema = z.object({
  kind: z.enum(["CODE", "SQL"]),
  language: text(20).optional(),
  title: text(120).optional(),
  subjectId: z.string().optional(),
  fixtureId: z.string().optional(),
  schemaSql: z.string().max(20_000).optional(),
});

export async function createFree(userId: string, raw: unknown) {
  const p = createFreeSchema.safeParse(raw);
  if (!p.success) throw new ApiHttpError(p.error.issues[0]?.message ?? "Demande invalide.", 422);
  const { kind } = p.data;
  const lang = kind === "SQL" ? "sql" : (languageOf(p.data.language ?? "python") ?? editorOnlyLanguage(p.data.language ?? ""));
  if (!lang || (kind === "CODE" && lang === "sql")) throw new ApiHttpError("Langage non pris en charge. Choisissez Python, JavaScript, TypeScript, C ou C#.", 422);
  const subjectId = await checkSubject(userId, p.data.subjectId);
  const fixture = p.data.fixtureId ? SQL_FIXTURES[p.data.fixtureId] : undefined;
  if (kind === "SQL" && p.data.fixtureId && !fixture) throw new ApiHttpError("Jeu de données inconnu.", 422);
  const f = DEFAULT_FILE[lang];
  const w = await db.labWorkspace.create({
    data: {
      userId,
      subjectId,
      kind,
      mode: "FREE",
      title: p.data.title ?? (kind === "SQL" ? `Requêtes SQL${fixture ? ` — ${fixture.label}` : ""}` : `Code ${lang === "csharp" ? "C#" : lang === "c" ? "C" : lang}`),
      files: [{ name: f.name, language: lang, content: f.content }] as unknown as Prisma.InputJsonValue,
      schemaSql: kind === "SQL" ? (p.data.schemaSql ?? fixture?.setupSql ?? SQL_FIXTURES.bibliotheque.setupSql) : null,
    },
  });
  await touchActivity(userId, w, false);
  return toDto(w);
}

export async function createFromQuestion(userId: string, raw: unknown) {
  const p = z.object({ exerciseId: z.string(), position: z.number().int().min(1) }).safeParse(raw);
  if (!p.success) throw new ApiHttpError("Demande invalide.", 422);
  const ex = assertFound(await db.exercise.findFirst({ where: { id: p.data.exerciseId, userId }, include: { questions: { where: { position: p.data.position } }, document: { select: { name: true } } } }), "Exercice");
  const q = assertFound(ex.questions[0], "Question");
  if (q.type !== "code" && q.type !== "sql") throw new ApiHttpError("Cette question n'est pas un exercice de programmation ou de SQL.", 422);
  const existing = await db.labWorkspace.findFirst({ where: { userId, exerciseId: ex.id, title: { startsWith: `Q${q.position}` } } });
  if (existing) return toDto(existing);
  const payload = q.payload as { statement: string; language?: string; starterCode?: string; setupSql?: string };
  const key = q.answerKey as { reference?: string; criteria?: string[]; verified?: boolean; tests?: unknown[]; sql?: unknown };
  const kind: LabKind = q.type === "sql" ? "SQL" : "CODE";
  const lang = kind === "SQL" ? "sql" : (languageOf(payload.language ?? "") ?? "python");
  const brief: Brief = {
    origin: "question",
    statement: payload.statement,
    language: lang,
    starter: kind === "SQL" ? "" : payload.starterCode,
    verified: !!key.verified,
    reference: key.reference,
    criteria: key.criteria,
    source: { exerciseId: ex.id, position: q.position, documentId: ex.documentId ?? undefined, documentName: ex.document?.name },
    ...(kind === "CODE" ? { tests: parseCodeTests(key.tests ?? []) } : { sql: sqlSpecSchema.safeParse(key.sql).data }),
  };
  const f = DEFAULT_FILE[lang] ?? DEFAULT_FILE.python;
  const start = kind === "SQL" ? "-- Votre requête\n" : payload.starterCode?.trim() ? payload.starterCode : f.content.split("\n")[0] + "\n";
  const w = await db.labWorkspace.create({
    data: { userId, subjectId: ex.subjectId, exerciseId: ex.id, kind, mode: "EXERCISE", title: `Q${q.position} — ${ex.title}`.slice(0, 160), files: [{ name: f.name, language: lang, content: start }] as unknown as Prisma.InputJsonValue, brief: brief as unknown as Prisma.InputJsonValue, schemaSql: kind === "SQL" ? (brief.sql?.setupSql ?? payload.setupSql ?? "") : null },
  });
  await touchActivity(userId, w, false);
  return toDto(w);
}

export async function createFromDocument(userId: string, raw: unknown) {
  const p = z.object({ documentId: z.string(), kind: z.enum(["CODE", "SQL"]), language: text(20).optional() }).safeParse(raw);
  if (!p.success) throw new ApiHttpError("Demande invalide.", 422);
  const res = await extractLabExercises(userId, p.data);
  const created: ReturnType<typeof toDto>[] = [];
  for (const e of res.exercises) {
    const lang = e.language;
    const f = DEFAULT_FILE[lang] ?? DEFAULT_FILE.python;
    const brief: Brief = {
      origin: "document",
      statement: e.statement,
      language: lang,
      starter: e.starter,
      tests: e.tests,
      sql: e.sql,
      verified: e.verified,
      reference: e.reference,
      source: { documentId: res.document.id, documentName: res.document.name, versionId: res.document.versionId, quote: e.quote, page: e.page },
    };
    const start = e.starter?.trim() ? e.starter : e.kind === "SQL" ? "-- Votre requête\n" : f.content.split("\n")[0] + "\n";
    const w = await db.labWorkspace.create({
      data: { userId, subjectId: res.document.subjectId, kind: e.kind, mode: "EXERCISE", title: e.title.slice(0, 160), files: [{ name: f.name, language: lang, content: start }] as unknown as Prisma.InputJsonValue, brief: brief as unknown as Prisma.InputJsonValue, schemaSql: e.kind === "SQL" ? (e.sql?.setupSql ?? "") : null },
    });
    await touchActivity(userId, w, false);
    created.push(toDto(w));
  }
  return { workspaces: created, notice: res.notice };
}

/** Résumés des exécutions avec tests (les plus récentes d'abord). */
async function testRunSummaries(userId: string, id: string) {
  const runs = await db.labRun.findMany({ where: { workspaceId: id, userId }, orderBy: { createdAt: "desc" }, select: { tests: true }, take: 50 });
  return runs.map((r) => (r.tests as { summary?: TestSummary } | null)?.summary).filter((x): x is TestSummary => !!x);
}

export async function getWorkspace(userId: string, id: string) {
  const w = await owned(userId, id);
  const runCount = await db.labRun.count({ where: { workspaceId: id, userId } });
  const brief = w.brief as unknown as Brief | null;
  const sums = brief ? await testRunSummaries(userId, id) : [];
  const canReveal = !!brief?.reference && !brief.revealedAt && (sums.some((s) => s.allPassed) || sums.length >= 3);
  return toDto(w, { runCount, canReveal, lastResult: sums[0] ? { passed: sums[0].passed, total: sums[0].total, allPassed: sums[0].allPassed } : null });
}

const updateSchema = z.object({ title: text(120).optional(), content: z.string().max(MAX_CODE).optional(), schemaSql: z.string().max(20_000).optional(), fixtureId: z.string().optional() });

export async function updateWorkspace(userId: string, id: string, raw: unknown) {
  const p = updateSchema.safeParse(raw);
  if (!p.success) throw new ApiHttpError(p.error.issues[0]?.message ?? "Demande invalide.", 422);
  const w = await owned(userId, id);
  const files = w.files as unknown as FileJson[];
  const data: Prisma.LabWorkspaceUpdateInput = {};
  if (p.data.title) data.title = p.data.title;
  if (p.data.content !== undefined) data.files = [{ ...files[0], content: p.data.content }] as unknown as Prisma.InputJsonValue;
  if (w.mode === "FREE" && w.kind === "SQL") {
    if (p.data.fixtureId) {
      const f = SQL_FIXTURES[p.data.fixtureId];
      if (!f) throw new ApiHttpError("Jeu de données inconnu.", 422);
      data.schemaSql = f.setupSql;
    } else if (p.data.schemaSql !== undefined) data.schemaSql = p.data.schemaSql;
  }
  const updated = await db.labWorkspace.update({ where: { id }, data });
  return toDto(updated);
}

export async function deleteWorkspace(userId: string, id: string) {
  await owned(userId, id);
  await db.labWorkspace.delete({ where: { id } });
  await db.learningActivity.deleteMany({ where: { userId, refType: "lab", refId: id } });
  return { ok: true };
}

// ── Exécution ────────────────────────────────────────────────────────────────

const runSchema = z.object({ mode: z.enum(["run", "tests"]).default("run"), content: z.string().max(MAX_CODE).optional(), stdin: z.string().max(4000).optional() });

function diagnoseFree(r: CodeCaseResult | undefined, sqlError?: { type: string; message: string }): Diagnosis[] {
  if (sqlError) {
    const reason = sqlErrorReason(sqlError.message);
    if (reason === "syntax") return [{ category: "SYNTAX", kind: "syntax", confidence: 0.95, label: "Erreur de syntaxe SQL.", tests: [] }];
    if (reason === "schema_name") return [{ category: "INSTRUCTION", kind: "schema_name", confidence: 0.7, label: "Une table ou une colonne n'existe pas dans le schéma.", tests: [] }];
    return [{ category: "LOGIC", kind: "runtime", confidence: 0.7, label: "La requête échoue à l'exécution.", tests: [] }];
  }
  if (!r) return [];
  if (r.status === "timeout") return [{ category: "LOGIC", kind: "timeout", confidence: 0.85, label: "Boucle infinie, récursion sans fin ou traitement trop long.", tests: [] }];
  if (r.status === "error" || r.status === "memory") {
    if (r.error?.type === "SyntaxError") return [{ category: "SYNTAX", kind: "syntax", confidence: 0.98, label: "Erreur de syntaxe : le code n'est pas valide pour le langage.", tests: [] }];
    return [{ category: "LOGIC", kind: "runtime", confidence: 0.85, label: "Le programme plante pendant l'exécution (exception).", tests: [] }];
  }
  return [];
}

export async function runWorkspace(userId: string, id: string, raw: unknown) {
  const p = runSchema.safeParse(raw ?? {});
  if (!p.success) throw new ApiHttpError(p.error.issues[0]?.message ?? "Demande invalide.", 422);
  const w = await owned(userId, id);
  const files = w.files as unknown as FileJson[];
  const content = p.data.content ?? files[0].content;
  if (p.data.content !== undefined && p.data.content !== files[0].content) {
    await db.labWorkspace.update({ where: { id }, data: { files: [{ ...files[0], content }] as unknown as Prisma.InputJsonValue } });
  }
  if (!content.trim()) throw new ApiHttpError("Le code est vide.", 422);
  const brief = (w.brief as unknown as Brief | null) ?? null;
  const lang = languageOf(files[0].language);
  if (!lang) {
    const only = editorOnlyLanguage(files[0].language);
    throw new ApiHttpError(
      only ? `Le langage ${only === "csharp" ? "C#" : "C"} n'est pas exécutable ici : l'éditeur offre la coloration et la saisie, mais aucun programme n'est compilé ni simulé.` : "Ce langage n'est pas exécutable ici.",
      422
    );
  }

  let output: Record<string, unknown> = {};
  let tests: { outcomes: TestOutcome[]; summary: TestSummary; diagnoses: Diagnosis[] } | null = null;
  let diagnoses: Diagnosis[] = [];
  let unavailable: string | undefined;

  if (p.data.mode === "tests") {
    if (!brief || !brief.verified) throw new ApiHttpError("Cet exercice n'a pas de tests automatiques validés : utilisez l'exécution libre.", 409);
    if (w.kind === "CODE") {
      if (lang === "sql" || !brief.tests?.length) throw new ApiHttpError("Aucun test disponible.", 409);
      const r = await runCodeTests(lang, content, brief.tests);
      unavailable = r.unavailable;
      tests = { outcomes: r.outcomes, summary: r.summary, diagnoses: r.diagnoses };
      diagnoses = r.diagnoses;
      output = { kind: "code", stdout: r.stdout ?? "", error: r.firstError };
    } else {
      if (!brief.sql) throw new ApiHttpError("Aucun test disponible.", 409);
      const r = await runSqlTests(brief.sql, content);
      unavailable = r.unavailable;
      tests = { outcomes: r.outcomes, summary: r.summary, diagnoses: r.diagnoses };
      diagnoses = r.diagnoses;
      output = { kind: "sql", statements: r.statements, schema: r.schema, error: r.userError };
    }
  } else if (w.kind === "CODE") {
    if (lang === "sql") throw new ApiHttpError("Langage invalide pour ce laboratoire.", 422);
    const r = await runCodeFree(lang, content, p.data.stdin);
    unavailable = r.unavailable;
    diagnoses = diagnoseFree(r.result);
    output = { kind: "code", ...(r.result ? { status: r.result.status, stdout: r.result.stdout, stderr: r.result.stderr, truncated: r.result.truncated, durationMs: r.result.durationMs, error: r.result.error } : {}) };
  } else {
    const setup = brief?.sql?.setupSql ?? w.schemaSql ?? "";
    const r = await runSqlFree(setup, content, false);
    unavailable = r.unavailable;
    const u = r.result?.user;
    diagnoses = r.result?.status === "timeout" ? [{ category: "LOGIC", kind: "timeout", confidence: 0.85, label: "Requête trop longue ou récursion infinie.", tests: [] }] : diagnoseFree(undefined, u?.error);
    output = { kind: "sql", status: r.result?.status, statements: u?.statements ?? [], schema: u?.schema ?? [], error: u?.error ?? (r.result?.status === "timeout" ? { type: "Timeout", message: r.result.error?.message ?? "Délai dépassé." } : undefined), durationMs: r.result?.durationMs };
  }

  if (unavailable) throw new ApiHttpError(`L'exécution isolée est indisponible : ${unavailable}`, 503);

  const run = await db.labRun.create({
    data: {
      userId,
      workspaceId: id,
      input: { mode: p.data.mode, content, stdin: p.data.stdin ?? null } as unknown as Prisma.InputJsonValue,
      output: output as unknown as Prisma.InputJsonValue,
      ...(tests ? { tests: tests as unknown as Prisma.InputJsonValue } : {}),
    },
  });
  if (diagnoses.length) {
    await db.errorDiagnosis.createMany({
      data: diagnoses.map((d) => ({ userId, labRunId: run.id, category: d.category as ErrorCategory, confidence: d.confidence, evidence: { source: tests ? "tests" : "execution", kind: d.kind, label: d.label, tests: d.tests, workspaceId: id } as unknown as Prisma.InputJsonValue })),
    });
  }
  await touchActivity(userId, w, tests?.summary.allPassed === true);
  if (tests) await refreshProgress(userId);
  return { id: run.id, createdAt: run.createdAt, mode: p.data.mode, output, tests, diagnoses };
}

export async function listRuns(userId: string, id: string) {
  await owned(userId, id);
  const runs = await db.labRun.findMany({ where: { workspaceId: id, userId }, orderBy: { createdAt: "desc" }, take: 30 });
  return runs.map((r) => {
    const input = r.input as { mode?: string; content?: string };
    const sum = (r.tests as { summary?: TestSummary } | null)?.summary;
    return { id: r.id, createdAt: r.createdAt, mode: input.mode ?? "run", content: input.content ?? "", summary: sum ?? null, output: r.output, tests: r.tests, evaluation: r.evaluation };
  });
}

// ── Indices & révélation ─────────────────────────────────────────────────────

export async function hintFor(userId: string, id: string, raw: unknown) {
  const p = z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1), runId: z.string().optional() }).safeParse(raw ?? {});
  if (!p.success) throw new ApiHttpError("Niveau d'indice invalide (1 à 3).", 422);
  const w = await owned(userId, id);
  const run = await db.labRun.findFirst({ where: { workspaceId: id, userId, ...(p.data.runId ? { id: p.data.runId } : {}) }, orderBy: { createdAt: "desc" } });
  if (!run) throw new ApiHttpError("Lancez d'abord votre code : l'indice s'appuie sur le résultat de l'exécution.", 409);
  const brief = (w.brief as unknown as Brief | null) ?? null;
  const tests = (run.tests as { outcomes: TestOutcome[]; diagnoses: Diagnosis[] } | null) ?? null;
  const out = run.output as { error?: { type: string; message: string; line?: number }; status?: string };
  const input = run.input as { content?: string };
  const free = tests ? [] : classifyFree(out);
  const hint = await generateHint(userId, {
    kind: w.kind,
    language: (w.files as unknown as FileJson[])[0].language,
    statement: brief?.statement ?? "(exercice libre : pas d'énoncé)",
    code: input.content ?? "",
    outcomes: tests?.outcomes ?? [],
    diagnoses: tests?.diagnoses ?? free,
    level: p.data.level as HintLevel,
    reference: brief?.reference,
    error: out.error ? `${out.error.type} : ${out.error.message}${out.error.line ? ` (ligne ${out.error.line})` : ""}` : undefined,
  });
  // L'IA peut soupçonner une notion mal comprise, une mauvaise démarche… : enregistré comme hypothèse faible, jamais comme certitude.
  if (hint.suspected.length) {
    await db.errorDiagnosis.createMany({
      data: hint.suspected.map((s) => ({ userId, labRunId: run.id, category: s.category as ErrorCategory, confidence: 0.5, evidence: { source: "ai", rationale: s.rationale, concept: hint.concept ?? null, workspaceId: id } as unknown as Prisma.InputJsonValue })),
    });
  }
  const prev = (run.evaluation as { hints?: unknown[] } | null)?.hints ?? [];
  await db.labRun.update({ where: { id: run.id }, data: { evaluation: { hints: [...prev, { level: hint.level, source: hint.source, message: hint.message, at: new Date().toISOString() }] } as unknown as Prisma.InputJsonValue } });
  return { runId: run.id, level: hint.level, source: hint.source, message: hint.message, concept: hint.concept ?? null };
}

function classifyFree(out: { error?: { type: string; message: string }; status?: string }): Diagnosis[] {
  if (out.status === "timeout") return classify([{ id: "x", name: "exécution", edge: false, hidden: false, weight: 1, status: "timeout", reason: "timeout" }]);
  if (out.error) return classify([{ id: "x", name: "exécution", edge: false, hidden: false, weight: 1, status: "error", reason: out.error.type === "SyntaxError" ? "syntax" : "runtime", message: out.error.message }]);
  return [];
}

/** Révèle la solution de référence : seulement après réussite ou après 3 essais avec tests (jamais d'emblée). */
export async function revealSolution(userId: string, id: string) {
  const w = await owned(userId, id);
  const brief = (w.brief as unknown as Brief | null) ?? null;
  if (!brief?.reference) throw new ApiHttpError("Pas de solution de référence pour cet espace de travail.", 404);
  const sums = await testRunSummaries(userId, id);
  if (!sums.some((s) => s.allPassed) && sums.length < 3) throw new ApiHttpError("La solution se débloque après une réussite ou 3 essais avec les tests. Essayez d'abord, ou demandez un indice.", 409);
  const revealedAt = brief.revealedAt ?? new Date().toISOString();
  if (!brief.revealedAt) await db.labWorkspace.update({ where: { id }, data: { brief: { ...brief, revealedAt } as unknown as Prisma.InputJsonValue } });
  return { reference: brief.reference, revealedAt, language: brief.language };
}
