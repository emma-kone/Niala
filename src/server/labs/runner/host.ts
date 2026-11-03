import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Exécution isolée du code étudiant.
//
// Chaque exécution lance UN processus Node dédié, avec :
//  - le mode `--permission` (aucun accès fichier hors lecture du runner et de ses moteurs,
//    ni processus enfants, ni workers, ni addons natifs, ni WASI) ;
//  - un environnement VIDE (aucun secret du serveur : DATABASE_URL, clés, AUTH_SECRET…) ;
//  - des moteurs WebAssembly (QuickJS, Pyodide, sql.js) : le code étudiant n'est jamais exécuté
//    par le moteur JavaScript du serveur, et n'a accès qu'à un système de fichiers mémoire ;
//  - un chien de garde (arrêt brutal au dépassement de délai) et une limite de sortie ;
//  - un protocole signé par un nonce aléatoire (le code étudiant ne peut pas falsifier les résultats).
// Les cas d'un lot sont exécutés dans le même processus ; en cas de dépassement, le cas fautif
// est marqué « timeout » et le processus est relancé pour les cas restants.
// ─────────────────────────────────────────────────────────────────────────────

export type Engine = "javascript" | "typescript" | "python" | "sql";

export interface CodeCaseSpec {
  id: string;
  stdin?: string;
  /** Appel d'une fonction du code étudiant avec des arguments JSON ; sa valeur de retour est comparée. */
  call?: { fn: string; args: unknown[] };
}

export interface SqlCaseSpec {
  id: string;
  setupSql: string;
  script: string;
  /** Script de référence exécuté sur la même base (jamais montré à l'étudiant). */
  reference?: string;
  /** Requêtes de contrôle exécutées après le script (état final de la base). */
  checks?: string[];
  readOnly?: boolean;
}

export interface RunnerError {
  type: string;
  message: string;
  line?: number;
}

export interface CodeCaseResult {
  id: string;
  status: "ok" | "error" | "timeout" | "memory" | "not_run";
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  error?: RunnerError;
  returned?: unknown;
  hasReturn?: boolean;
  nonJson?: boolean;
}

export interface SqlResultSet {
  columns: string[];
  rows: unknown[][];
  error?: string;
}

export interface SqlScriptOutcome {
  statements: { sql: string; columns?: string[]; rows?: unknown[][]; rowCount?: number; changes?: number }[];
  lastSelect?: SqlResultSet;
  checks: SqlResultSet[];
  schema: { name: string; columns: { name: string; type: string; notNull: boolean; pk: boolean }[]; foreignKeys: { from: string; table: string; to: string }[] }[];
  error?: RunnerError;
}

export interface SqlCaseResult {
  id: string;
  status: "ok" | "error" | "timeout" | "not_run";
  durationMs: number;
  user?: SqlScriptOutcome;
  expected?: SqlScriptOutcome;
  error?: RunnerError;
}

export interface RunLimits {
  caseTimeoutMs: number;
  outputChars: number;
  /** Durée totale maximale de tout le lot, redémarrages compris. */
  totalBudgetMs: number;
}

export const DEFAULT_LIMITS: RunLimits = { caseTimeoutMs: 5000, outputChars: 20_000, totalBudgetMs: 40_000 };
const STARTUP_TIMEOUT_MS = 45_000;
const MAX_RESTARTS = 8;
const MAX_CONCURRENT = Number(process.env.LAB_MAX_CONCURRENT ?? 3);

export type BatchResult<R> = { results: R[]; unavailable?: string; startupMs: number };

// ── Limite de concurrence (chaque processus Pyodide pèse ~100 Mo) ──
let running = 0;
const waiters: (() => void)[] = [];
async function acquire() {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => waiters.push(r));
  running++;
}
function release() {
  running--;
  waiters.shift()?.();
}

function paths() {
  const root = /* turbopackIgnore: true */ process.cwd();
  const dir = path.join(root, "src", "server", "labs", "runner");
  return { dir, child: path.join(dir, "child.mjs"), modules: path.join(root, "node_modules") };
}

export function runnerAvailable(): { ok: boolean; reason?: string } {
  const p = paths();
  if (!existsSync(p.child)) return { ok: false, reason: "Le moteur d'exécution isolée est absent de ce déploiement." };
  if (!existsSync(p.modules)) return { ok: false, reason: "Les moteurs d'exécution (QuickJS, Pyodide, sql.js) ne sont pas installés." };
  return { ok: true };
}

interface Session {
  done: boolean;
  fatal?: string;
  killedBy?: "timeout" | "output" | "startup";
  /** Cas terminés pendant cette session. */
  results: Map<string, unknown>;
  startupMs: number;
}

function runSession(request: Record<string, unknown> & { cases: { id: string }[] }, limits: RunLimits, deadline: number): Promise<Session> {
  const p = paths();
  const nonce = randomBytes(12).toString("hex");
  const header = `@@SF@@${nonce}:`;
  return new Promise((resolve) => {
    const started = Date.now();
    const session: Session = { done: false, results: new Map(), startupMs: 0 };
    const child = spawn(
      process.execPath,
      ["--permission", `--allow-fs-read=${p.dir}`, `--allow-fs-read=${p.modules}`, "--max-old-space-size=160", "--disallow-code-generation-from-strings", p.child],
      {
        cwd: p.dir,
        // Environnement vide : aucun secret du serveur n'est visible du code étudiant.
        env: (process.platform === "win32" && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let buf = "";
    let total = 0;
    let ready = false;
    let timer: NodeJS.Timeout | undefined;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve(session);
    };
    const arm = (ms: number, why: "timeout" | "startup") => {
      if (timer) clearTimeout(timer);
      const left = Math.max(1, deadline - Date.now());
      timer = setTimeout(() => {
        session.killedBy = why;
        finish();
      }, Math.min(ms, left));
    };
    arm(STARTUP_TIMEOUT_MS, "startup");

    child.stdout.on("data", (d: Buffer) => {
      total += d.length;
      if (total > 8 * 1024 * 1024) {
        session.killedBy = "output";
        return finish();
      }
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.startsWith(header)) continue; // toute autre ligne est ignorée (donc non fiable)
        let m: { t: string; id?: string; message?: string; [k: string]: unknown };
        try {
          m = JSON.parse(line.slice(header.length));
        } catch {
          continue;
        }
        if (m.t === "ready") {
          ready = true;
          session.startupMs = Date.now() - started;
          arm(limits.caseTimeoutMs, "timeout");
        } else if (m.t === "case" && m.id) {
          session.results.set(m.id, m);
          arm(limits.caseTimeoutMs, "timeout");
        } else if (m.t === "done") {
          session.done = true;
          finish();
        } else if (m.t === "fatal") {
          session.fatal = m.message ?? "Erreur du moteur d'exécution.";
          finish();
        }
      }
    });
    child.stderr.on("data", () => {}); // inutile : la sortie étudiante ne passe jamais par ici
    child.on("error", (e) => {
      session.fatal = `Impossible de lancer l'environnement d'exécution : ${e.message}`;
      finish();
    });
    child.on("close", () => {
      if (!ready && !session.fatal && !session.killedBy) session.fatal = "Le moteur d'exécution s'est arrêté de façon inattendue.";
      finish();
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ ...request, nonce, limits }));
  });
}

/** Exécute un lot de cas ; relance le moteur après chaque cas bloqué. */
async function runBatch<S extends { id: string }, R extends { id: string; status: string; durationMs: number }>(
  engineRequest: Record<string, unknown>,
  cases: S[],
  limits: RunLimits,
  makeFailure: (id: string, status: "timeout" | "not_run", message: string) => R,
): Promise<BatchResult<R>> {
  const avail = runnerAvailable();
  if (!avail.ok) return { results: [], unavailable: avail.reason, startupMs: 0 };
  await acquire();
  try {
    const deadline = Date.now() + limits.totalBudgetMs;
    const done = new Map<string, R>();
    let remaining = cases;
    let startupMs = 0;
    for (let attempt = 0; attempt <= MAX_RESTARTS && remaining.length > 0; attempt++) {
      if (Date.now() >= deadline) break;
      const s = await runSession({ ...engineRequest, cases: remaining }, limits, deadline);
      if (attempt === 0) startupMs = s.startupMs;
      for (const [id, r] of s.results) done.set(id, r as R);
      if (s.fatal && s.results.size === 0) return { results: [], unavailable: s.fatal, startupMs };
      if (s.done) break;
      const left = remaining.filter((c) => !done.has(c.id));
      if (left.length === 0) break;
      if (s.killedBy === "startup" || s.killedBy === "output") {
        // moteur incapable de démarrer / flot de sortie : inutile d'insister
        for (const c of left) done.set(c.id, makeFailure(c.id, "not_run", s.killedBy === "output" ? "Sortie excessive : exécution arrêtée." : "Le moteur d'exécution n'a pas démarré à temps."));
        break;
      }
      // timeout : le premier cas restant est le fautif ; on relance pour les suivants
      done.set(left[0].id, makeFailure(left[0].id, "timeout", `Délai dépassé (${Math.round(limits.caseTimeoutMs / 1000)} s) : boucle infinie ou calcul trop long ?`));
      remaining = left.slice(1);
    }
    for (const c of cases) if (!done.has(c.id)) done.set(c.id, makeFailure(c.id, "not_run", "Non exécuté (budget de temps épuisé)."));
    return { results: cases.map((c) => done.get(c.id)!), startupMs };
  } finally {
    release();
  }
}

export function isExecutable(language: string): language is Engine {
  return ["javascript", "typescript", "python", "sql"].includes(language);
}

export function runCodeCases(language: "javascript" | "typescript" | "python", code: string, cases: CodeCaseSpec[], limits: Partial<RunLimits> = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const engine = language === "python" ? "python" : "javascript";
  return runBatch<CodeCaseSpec, CodeCaseResult>({ engine, language, code }, cases, lim, (id, status, message) => ({
    id,
    status,
    stdout: "",
    stderr: "",
    truncated: false,
    durationMs: status === "timeout" ? lim.caseTimeoutMs : 0,
    error: { type: status === "timeout" ? "Timeout" : "NotRun", message },
  }));
}

export function runSqlCases(cases: SqlCaseSpec[], limits: Partial<RunLimits> = {}) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  return runBatch<SqlCaseSpec, SqlCaseResult>({ engine: "sql" }, cases, lim, (id, status, message) => ({
    id,
    status,
    durationMs: status === "timeout" ? lim.caseTimeoutMs : 0,
    error: { type: status === "timeout" ? "Timeout" : "NotRun", message },
  }));
}
