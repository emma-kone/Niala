import { z } from "zod";
import type { CodeCaseResult, CodeCaseSpec, SqlCaseResult, SqlCaseSpec, SqlResultSet } from "@/server/labs/runner/host";

// ─────────────────────────────────────────────────────────────────────────────
// Tests OBJECTIFS des laboratoires : définition, comparaison, score et classification des erreurs.
// Fonctions pures (sans exécution) : l'exécution se fait dans le runner isolé.
// Le verdict d'un test ne dépend jamais d'une IA.
// ─────────────────────────────────────────────────────────────────────────────

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

export const codeTestSchema = z
  .object({
    name: text(80),
    /** Entrée standard fournie au programme (lue par input() / readLine()). */
    stdin: z.string().max(2000).optional(),
    /** Appel d'une fonction du code étudiant : la valeur retournée est comparée à `expected`. */
    call: z.object({ fn: z.string().regex(/^[A-Za-z_$][\w$]*$/, "nom de fonction invalide").max(60), args: z.array(z.unknown()).max(8) }).optional(),
    /** Sortie standard attendue (texte) ou valeur de retour attendue (JSON) si `call` est fourni. */
    expected: z.unknown(),
    /** Cas limite (vide, zéro, négatif, doublon…) : suivi à part dans le diagnostic. */
    edge: z.boolean().default(false),
    /** Test caché : l'étudiant voit qu'il échoue, pas la valeur attendue. */
    hidden: z.boolean().default(false),
    weight: z.number().min(1).max(5).default(1),
  })
  .superRefine((t, ctx) => {
    if (!t.call && typeof t.expected !== "string") ctx.addIssue({ code: "custom", path: ["expected"], message: "La sortie attendue doit être un texte." });
    if (t.expected === undefined) ctx.addIssue({ code: "custom", path: ["expected"], message: "Valeur attendue manquante." });
  });
export type CodeTest = z.infer<typeof codeTestSchema>;

/** Garde les tests valides d'une liste proposée (par l'IA ou l'utilisateur) ; les autres sont écartés. */
export function parseCodeTests(raw: unknown[]): CodeTest[] {
  const out: CodeTest[] = [];
  for (const r of raw) {
    const p = codeTestSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out.slice(0, 10);
}

export const sqlSpecSchema = z.object({
  setupSql: z.string().max(8000).default(""),
  referenceSql: text(4000),
  /** Requêtes de contrôle de l'état final de la base (pour les exercices INSERT/UPDATE/DELETE/DDL). */
  checks: z.array(text(1000)).max(3).default([]),
  /** Le résultat doit-il respecter l'ordre des lignes (ORDER BY demandé) ? */
  ordered: z.boolean().default(false),
  /** Exiger les mêmes noms de colonnes (sinon seul le nombre de colonnes compte). */
  strictColumns: z.boolean().default(false),
  /** Jeux de données supplémentaires (cas limites) ajoutés après setupSql. */
  variants: z.array(z.object({ name: text(80), extraSql: text(3000) })).max(4).default([]),
});
export type SqlSpec = z.infer<typeof sqlSpecSchema>;

export type TestStatus = "pass" | "fail" | "error" | "timeout" | "not_run";

export interface TestOutcome {
  id: string;
  name: string;
  edge: boolean;
  hidden: boolean;
  weight: number;
  status: TestStatus;
  /** Raison d'échec, lisible. */
  message?: string;
  /** Sous-type d'échec utile au diagnostic. */
  reason?: "wrong_output" | "format" | "runtime" | "syntax" | "timeout" | "memory" | "missing_function" | "columns" | "rows_missing" | "rows_extra" | "order" | "values" | "sql_error" | "schema_name";
  expected?: unknown;
  actual?: unknown;
  stdout?: string;
  error?: { type: string; message: string; line?: number };
}

// ── Comparaison ──────────────────────────────────────────────────────────────
const normLines = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.\-]+/gu, " ").trim();

/** `ok` : identique (espaces de fin ignorés). `format` : même contenu mais présentation différente. */
export function compareStdout(expected: string, actual: string): { ok: boolean; format: boolean } {
  if (normLines(expected) === normLines(actual)) return { ok: true, format: false };
  return { ok: false, format: squash(expected) === squash(actual) && squash(expected) !== "" };
}

export function jsonEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

// ── Code ─────────────────────────────────────────────────────────────────────
export function codeCasesFor(tests: CodeTest[]): CodeCaseSpec[] {
  return tests.map((t, i) => ({ id: `t${i}`, stdin: t.stdin, call: t.call }));
}

const SHOWN = 400;
const clip = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > SHOWN ? s.slice(0, SHOWN) + "…" : v;
};

export function outcomeOfCode(t: CodeTest, id: string, r: CodeCaseResult | undefined): TestOutcome {
  const base = { id, name: t.name, edge: t.edge, hidden: t.hidden, weight: t.weight };
  const show = t.hidden ? {} : { expected: clip(t.expected) };
  if (!r || r.status === "not_run") return { ...base, status: "not_run", message: r?.error?.message ?? "Non exécuté." };
  if (r.status === "timeout") return { ...base, status: "timeout", reason: "timeout", message: r.error?.message ?? "Délai dépassé.", ...show };
  if (r.status === "memory") return { ...base, status: "error", reason: "memory", message: "Mémoire dépassée.", ...show };
  if (r.status === "error") {
    const syntax = r.error?.type === "SyntaxError";
    const missing = /n'est pas définie/.test(r.error?.message ?? "") && !!t.call;
    return { ...base, status: "error", reason: syntax ? "syntax" : missing ? "missing_function" : "runtime", message: `${r.error?.type ?? "Erreur"} : ${r.error?.message ?? ""}`.trim(), error: r.error, stdout: r.stdout.slice(0, SHOWN), ...show };
  }
  if (t.call) {
    const ok = jsonEqual(t.expected, r.returned) && r.hasReturn === true;
    return ok ? { ...base, status: "pass" } : { ...base, status: "fail", reason: "wrong_output", message: r.hasReturn ? "Valeur retournée incorrecte." : "La fonction ne retourne rien.", actual: clip(r.returned), stdout: r.stdout.slice(0, SHOWN), ...show };
  }
  const cmp = compareStdout(String(t.expected), r.stdout);
  if (cmp.ok) return { ...base, status: "pass" };
  return { ...base, status: "fail", reason: cmp.format ? "format" : "wrong_output", message: cmp.format ? "Le contenu est bon mais la présentation de la sortie diffère de la consigne." : "Sortie incorrecte.", actual: clip(r.stdout), ...show };
}

// ── SQL ──────────────────────────────────────────────────────────────────────
export function sqlCasesFor(spec: SqlSpec, script: string, opts: { readOnly?: boolean } = {}): (SqlCaseSpec & { edge: boolean; name: string })[] {
  const mk = (id: string, name: string, extra: string, edge: boolean) => ({ id, name, edge, setupSql: [spec.setupSql, extra].filter(Boolean).join("\n"), script, reference: spec.referenceSql, checks: spec.checks, readOnly: opts.readOnly });
  return [mk("base", "Jeu de données de l'énoncé", "", false), ...spec.variants.map((v, i) => mk(`v${i}`, v.name, v.extraSql, true))];
}

const cell = (v: unknown) => (typeof v === "number" ? String(Math.round(v * 1e9) / 1e9) : v === null || v === undefined ? "NULL" : typeof v === "string" ? `'${v}'` : String(v));
const rowKey = (r: unknown[]) => r.map(cell).join("|");

export function compareResultSets(expected: SqlResultSet, actual: SqlResultSet, spec: Pick<SqlSpec, "ordered" | "strictColumns">, hidden: boolean): Pick<TestOutcome, "status" | "reason" | "message" | "expected" | "actual"> {
  if (expected.columns.length !== actual.columns.length) {
    return { status: "fail", reason: "columns", message: `La requête doit renvoyer ${expected.columns.length} colonne(s) ; la vôtre en renvoie ${actual.columns.length}.` };
  }
  if (spec.strictColumns && expected.columns.some((c, i) => c.toLowerCase() !== actual.columns[i].toLowerCase())) {
    return { status: "fail", reason: "columns", message: `Les colonnes doivent s'appeler : ${expected.columns.join(", ")}.` };
  }
  const exp = expected.rows.map(rowKey);
  const act = actual.rows.map(rowKey);
  const original = new Map<string, unknown[]>([...expected.rows, ...actual.rows].map((r) => [rowKey(r), r]));
  const count = new Map<string, number>();
  for (const k of exp) count.set(k, (count.get(k) ?? 0) + 1);
  const extra: string[] = [];
  for (const k of act) {
    const n = count.get(k) ?? 0;
    if (n > 0) count.set(k, n - 1);
    else extra.push(k);
  }
  const missing = [...count.entries()].flatMap(([k, n]) => Array(n).fill(k) as string[]);
  const sample = (a: string[]) => (hidden ? undefined : a.slice(0, 3).map((k) => original.get(k)));
  if (missing.length === 0 && extra.length === 0) {
    if (spec.ordered && exp.some((k, i) => k !== act[i])) return { status: "fail", reason: "order", message: "Les bonnes lignes sont là, mais dans le mauvais ordre (ORDER BY ?)." };
    return { status: "pass" };
  }
  if (missing.length > 0 && extra.length > 0 && missing.length === extra.length) {
    return { status: "fail", reason: "values", message: `${missing.length} ligne(s) ont des valeurs différentes de celles attendues.`, expected: sample(missing), actual: sample(extra) };
  }
  if (missing.length > 0 && extra.length === 0) return { status: "fail", reason: "rows_missing", message: `Il manque ${missing.length} ligne(s) dans le résultat.`, expected: sample(missing) };
  if (extra.length > 0 && missing.length === 0) return { status: "fail", reason: "rows_extra", message: `${extra.length} ligne(s) en trop dans le résultat.`, actual: sample(extra) };
  return { status: "fail", reason: "values", message: `Résultat différent : ${missing.length} ligne(s) manquante(s), ${extra.length} en trop.`, expected: sample(missing), actual: sample(extra) };
}

export function sqlErrorReason(message: string): TestOutcome["reason"] {
  if (/syntax error|incomplete input|unrecognized token|near "/i.test(message)) return "syntax";
  if (/no such (table|column)|ambiguous column|has no column/i.test(message)) return "schema_name";
  return "sql_error";
}

export function outcomeOfSql(spec: SqlSpec, c: { id: string; name: string; edge: boolean }, r: SqlCaseResult | undefined): TestOutcome {
  const base = { id: c.id, name: c.name, edge: c.edge, hidden: false, weight: 1 };
  if (!r || r.status === "not_run") return { ...base, status: "not_run", message: r?.error?.message ?? "Non exécuté." };
  if (r.status === "timeout") return { ...base, status: "timeout", reason: "timeout", message: r.error?.message ?? "Délai dépassé (requête trop longue ou récursion infinie ?)." };
  if (r.status === "error" || !r.user || !r.expected) return { ...base, status: "error", reason: "runtime", message: r.error?.message ?? "Erreur d'exécution." };
  if (r.expected.error) return { ...base, status: "error", reason: "runtime", message: "La solution de référence a échoué sur ce jeu de données : test ignoré par prudence." };
  if (r.user.error) return { ...base, status: "error", reason: sqlErrorReason(r.user.error.message), message: r.user.error.message, error: r.user.error };

  const results: { exp: SqlResultSet; act: SqlResultSet; label: string }[] = [];
  if (spec.checks.length > 0) spec.checks.forEach((_, i) => results.push({ exp: r.expected!.checks[i], act: r.user!.checks[i], label: `contrôle ${i + 1}` }));
  else if (r.expected.lastSelect) {
    if (!r.user.lastSelect) return { ...base, status: "fail", reason: "wrong_output", message: "Votre script ne produit aucun résultat (SELECT attendu)." };
    results.push({ exp: r.expected.lastSelect, act: r.user.lastSelect, label: "résultat" });
  }
  for (const x of results) {
    if (!x.exp || !x.act) continue;
    if (x.act.error) return { ...base, status: "fail", reason: "schema_name", message: `Le contrôle a échoué après votre script : ${x.act.error}` };
    const cmp = compareResultSets(x.exp, x.act, spec, false);
    if (cmp.status === "fail") return { ...base, ...cmp, message: results.length > 1 ? `Contrôle ${x.label} : ${cmp.message}` : cmp.message };
  }
  return { ...base, status: "pass" };
}

// ── Score ────────────────────────────────────────────────────────────────────
export interface TestSummary {
  passed: number;
  total: number;
  /** Rapport de points pondérés réussis (0..1). */
  ratio: number;
  edgePassed: number;
  edgeTotal: number;
  allPassed: boolean;
}

export function summarize(outcomes: TestOutcome[]): TestSummary {
  const total = outcomes.length;
  const weight = outcomes.reduce((s, o) => s + o.weight, 0) || 1;
  const gained = outcomes.filter((o) => o.status === "pass").reduce((s, o) => s + o.weight, 0);
  const edge = outcomes.filter((o) => o.edge);
  return { passed: outcomes.filter((o) => o.status === "pass").length, total, ratio: gained / weight, edgePassed: edge.filter((o) => o.status === "pass").length, edgeTotal: edge.length, allPassed: total > 0 && outcomes.every((o) => o.status === "pass") };
}

// ── Classification des erreurs ───────────────────────────────────────────────
/** Catégories de la base (ErrorCategory) ; `kind` précise la nature observée. */
export type Category = "SYNTAX" | "LOGIC" | "CONCEPT" | "METHOD" | "INSTRUCTION" | "FORGETTING" | "CARELESS";
export type DiagnosisKind = "syntax" | "runtime" | "timeout" | "wrong_output" | "edge_case" | "format" | "instructions" | "schema_name" | "partial";

export interface Diagnosis {
  category: Category;
  kind: DiagnosisKind;
  confidence: number;
  label: string;
  /** Tests concernés. */
  tests: string[];
}

/**
 * Classification DÉTERMINISTE à partir des résultats de tests. Concept, méthode et qualité du code
 * ne se déduisent pas de tests : ils ne sont proposés que par l'explication IA, jamais ici.
 */
export function classify(outcomes: TestOutcome[]): Diagnosis[] {
  const bad = outcomes.filter((o) => o.status !== "pass" && o.status !== "not_run");
  if (bad.length === 0) return [];
  const out: Diagnosis[] = [];
  const by = (pred: (o: TestOutcome) => boolean) => bad.filter(pred).map((o) => o.name);

  const syntax = by((o) => o.reason === "syntax");
  if (syntax.length) out.push({ category: "SYNTAX", kind: "syntax", confidence: 0.98, label: "Erreur de syntaxe : le code n'est pas valide pour le langage.", tests: syntax });

  const names = by((o) => o.reason === "missing_function" || o.reason === "schema_name" || o.reason === "columns");
  if (names.length) out.push({ category: "INSTRUCTION", kind: "instructions", confidence: 0.8, label: "Un nom ou une forme imposés par l'énoncé n'est pas respecté (fonction, table, colonne, nombre de colonnes).", tests: names });

  const format = by((o) => o.reason === "format");
  if (format.length) out.push({ category: "INSTRUCTION", kind: "format", confidence: 0.85, label: "Le résultat est juste sur le fond mais la présentation demandée n'est pas respectée.", tests: format });

  const runtime = by((o) => o.reason === "runtime" || o.reason === "memory" || o.reason === "sql_error");
  if (runtime.length) out.push({ category: "LOGIC", kind: "runtime", confidence: 0.85, label: "Le programme plante pendant l'exécution (exception).", tests: runtime });

  const timeout = by((o) => o.reason === "timeout");
  if (timeout.length) out.push({ category: "LOGIC", kind: "timeout", confidence: 0.85, label: "Boucle infinie, récursion sans fin ou traitement bien trop long.", tests: timeout });

  const wrong = bad.filter((o) => o.status === "fail" && ["wrong_output", "rows_missing", "rows_extra", "order", "values"].includes(o.reason ?? ""));
  const wrongBasic = wrong.filter((o) => !o.edge);
  const wrongEdge = wrong.filter((o) => o.edge);
  if (wrongBasic.length) out.push({ category: "LOGIC", kind: "wrong_output", confidence: 0.8, label: "Le résultat obtenu ne correspond pas au résultat attendu.", tests: wrongBasic.map((o) => o.name) });
  if (wrongEdge.length && wrongBasic.length === 0) out.push({ category: "LOGIC", kind: "edge_case", confidence: 0.75, label: "Les cas courants passent, mais pas les cas limites (vide, zéro, valeurs absentes…).", tests: wrongEdge.map((o) => o.name) });
  return out;
}

export function languageOf(l: string): "javascript" | "typescript" | "python" | "sql" | null {
  const v = l.toLowerCase();
  if (v === "js" || v === "javascript") return "javascript";
  if (v === "ts" || v === "typescript") return "typescript";
  if (v === "py" || v === "python") return "python";
  if (v === "sql" || v === "sqlite") return "sql";
  return null;
}
