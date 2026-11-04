// Processus enfant d'exécution isolée (lancé par host.ts avec `node --permission`, environnement vide).
// Il lit UNE requête JSON sur stdin et répond par des lignes `@@SF@@{json}` sur stdout.
// Moteurs, tous compilés en WebAssembly : QuickJS (JS/TS), Pyodide (Python), sql.js (SQL).

import fs from "node:fs";
import os from "node:os";

// Références gardées avant de masquer `process` au code étudiant (Pyodide expose le module `js`).
const proc = process;
const PREFIX = "@@SF@@";
const writeOut = proc.stdout.write.bind(proc.stdout);
let NONCE = "";
const send = (m) => writeOut(PREFIX + NONCE + ":" + JSON.stringify(m) + "\n");

/** Retire `process` de l'objet global : le code Python l'atteindrait via `from js import process`. */
function lockdown() {
  try {
    delete globalThis.process;
  } catch {}
}

// Le code étudiant n'a aucune raison de joindre le réseau : on retire les accès globaux
// (Pyodide expose le module `js`, donc l'objet global de ce processus).
for (const k of ["fetch", "WebSocket", "XMLHttpRequest", "EventSource", "Request", "Response", "Headers"]) {
  try {
    delete globalThis[k];
  } catch {}
}

const readStdin = () =>
  new Promise((resolve) => {
    let s = "";
    proc.stdin.setEncoding("utf8");
    proc.stdin.on("data", (d) => (s += d));
    proc.stdin.on("end", () => resolve(s));
  });

// ───────────────────────── JavaScript / TypeScript (QuickJS) ─────────────────────────
function jsErr(ctx, h) {
  const e = ctx.dump(h);
  const stack = String(e?.stack ?? "");
  const line = (stack.match(/solution\.js:(\d+)/) ?? [])[1];
  return { type: String(e?.name ?? "Error"), message: String(e?.message ?? e), line: line ? Number(line) : undefined };
}

function failAll(req, error) {
  send({ t: "ready" });
  for (const c of req.cases) send({ t: "case", id: c.id, status: "error", stdout: "", stderr: "", truncated: false, durationMs: 0, error });
}

async function jsEngine(req) {
  const { getQuickJS, shouldInterruptAfterDeadline } = await import("quickjs-emscripten");
  const QuickJS = await getQuickJS();
  lockdown();
  let code = req.code;
  if (req.language === "typescript") {
    const { transform } = await import("sucrase");
    try {
      code = transform(code, { transforms: ["typescript"] }).code;
    } catch (e) {
      const m = String(e.message);
      const line = (m.match(/\((\d+):\d+\)/) ?? [])[1];
      return failAll(req, { type: "SyntaxError", message: m.replace(/\s*\(\d+:\d+\)$/, ""), line: line ? Number(line) : undefined });
    }
  }
  send({ t: "ready" });
  for (const c of req.cases) {
    const started = Date.now();
    const rt = QuickJS.newRuntime();
    rt.setMemoryLimit(64 * 1024 * 1024);
    rt.setMaxStackSize(512 * 1024);
    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + Math.max(500, req.limits.caseTimeoutMs - 500)));
    const ctx = rt.newContext();
    let out = "";
    let err = "";
    let truncated = false;
    const cap = req.limits.outputChars;
    const fmt = (args) =>
      args
        .map((h) => {
          const v = ctx.dump(h);
          if (typeof v === "string") return v;
          try {
            return JSON.stringify(v) ?? String(v);
          } catch {
            return String(v);
          }
        })
        .join(" ");
    const consoleObj = ctx.newObject();
    for (const [name, isErr] of [["log", false], ["info", false], ["warn", true], ["error", true]]) {
      const fn = ctx.newFunction(name, (...args) => {
        const line = fmt(args) + "\n";
        if (isErr) {
          if (err.length < cap) err += line;
          else truncated = true;
        } else if (out.length < cap) out += line;
        else truncated = true;
      });
      ctx.setProp(consoleObj, name, fn);
      fn.dispose();
    }
    ctx.setProp(ctx.global, "console", consoleObj);
    consoleObj.dispose();
    const lines = String(c.stdin ?? "").split("\n");
    if (lines.at(-1) === "") lines.pop();
    let li = 0;
    const rl = ctx.newFunction("readLine", () => (li < lines.length ? ctx.newString(lines[li++]) : ctx.null));
    ctx.setProp(ctx.global, "readLine", rl);
    rl.dispose();

    const res = { id: c.id, status: "ok" };
    try {
      const r = ctx.evalCode(code, "solution.js");
      if (r.error) {
        res.status = "error";
        res.error = jsErr(ctx, r.error);
        r.error.dispose();
      } else {
        r.value.dispose();
        if (c.call) {
          const fnName = String(c.call.fn).replace(/[^\w$]/g, "");
          const call = `(async () => { const __f = globalThis.${fnName}; if (typeof __f !== "function") throw new ReferenceError("La fonction ${fnName} n'est pas définie."); const __r = await __f(...${JSON.stringify(c.call.args ?? [])}); return __r === undefined ? "null" : JSON.stringify(__r); })()`;
          const cr = ctx.evalCode(call, "harness.js");
          if (cr.error) {
            res.status = "error";
            res.error = jsErr(ctx, cr.error);
            cr.error.dispose();
          } else {
            const pr = ctx.resolvePromise(cr.value);
            cr.value.dispose();
            ctx.runtime.executePendingJobs();
            const settled = await pr;
            if (settled.error) {
              res.status = "error";
              res.error = jsErr(ctx, settled.error);
              settled.error.dispose();
            } else {
              const v = ctx.dump(settled.value);
              settled.value.dispose();
              res.returned = JSON.parse(v);
              res.hasReturn = true;
            }
          }
        } else {
          ctx.runtime.executePendingJobs();
        }
      }
    } catch (e) {
      res.status = "error";
      res.error = { type: "InternalError", message: String(e?.message ?? e).slice(0, 300) };
    }
    if (res.error && /interrupted/i.test(res.error.message)) {
      res.status = "timeout";
      res.error = { type: "Timeout", message: "Délai dépassé." };
    }
    if (res.error && /out of memory/i.test(res.error.message)) res.status = "memory";
    res.stdout = out;
    res.stderr = err;
    res.truncated = truncated;
    res.durationMs = Date.now() - started;
    try {
      ctx.dispose();
      rt.dispose();
    } catch {}
    send({ t: "case", ...res });
  }
}

// ───────────────────────── Python (Pyodide) ─────────────────────────
const PY_HARNESS = `
import sys, io, json, traceback
class _Cap(io.StringIO):
    def __init__(self, cap):
        super().__init__()
        self._cap = cap
        self.over = False
    def write(self, s):
        if self.tell() >= self._cap:
            self.over = True
            return len(s)
        return super().write(s)
def _run(code, stdin, call_json, cap):
    call = json.loads(call_json) if call_json else None
    out, err = _Cap(cap), _Cap(cap)
    so, se, si = sys.stdout, sys.stderr, sys.stdin
    sys.stdout, sys.stderr, sys.stdin = out, err, io.StringIO(stdin or "")
    res = {"status": "ok"}
    ns = {"__name__": "__main__"}
    try:
        exec(compile(code, "solution.py", "exec"), ns)
        if call:
            fn = ns.get(call["fn"])
            if not callable(fn):
                raise NameError("La fonction " + str(call["fn"]) + " n'est pas définie.")
            r = fn(*call.get("args", []))
            try:
                json.dumps(r)
                res["returned"] = r
            except Exception:
                res["returned"] = repr(r)
                res["nonJson"] = True
            res["hasReturn"] = True
    except SystemExit:
        pass
    except BaseException as e:
        line = None
        if isinstance(e, SyntaxError):
            line = e.lineno
        else:
            for fr in traceback.extract_tb(e.__traceback__):
                if fr.filename == "solution.py":
                    line = fr.lineno
        res["status"] = "error"
        msg = str(e)[:500]
        if isinstance(e, RecursionError):
            msg = "Récursion trop profonde."
        res["error"] = {"type": type(e).__name__, "message": msg, "line": line}
        if isinstance(e, MemoryError):
            res["status"] = "memory"
    finally:
        sys.stdout, sys.stderr, sys.stdin = so, se, si
    res["stdout"], res["stderr"], res["truncated"] = out.getvalue(), err.getvalue(), out.over or err.over
    return json.dumps(res)
`;

async function pyEngine(req) {
  const { loadPyodide } = await import("pyodide");
  const { fileURLToPath } = await import("node:url");
  const indexURL = fileURLToPath(new URL(".", import.meta.resolve("pyodide")));
  // Emscripten (Pyodide) lit process.binding("constants") à l'initialisation ; le mode --permission l'interdit.
  // On fournit uniquement ces constantes, puis on referme tout accès.
  const realBinding = proc.binding;
  proc.binding = (name) => {
    if (name === "constants") return { fs: fs.constants, os: os.constants, crypto: {}, zlib: {}, trace: {} };
    throw new Error("process.binding est interdit.");
  };
  const py = await loadPyodide({ indexURL, stdout: () => {}, stderr: () => {}, checkAPIVersion: false });
  proc.binding = realBinding;
  py.runPython(PY_HARNESS);
  py.runPython("import sys; sys.setrecursionlimit(800)");
  const run = py.globals.get("_run");
  lockdown();
  send({ t: "ready" });
  for (const c of req.cases) {
    const started = Date.now();
    let res;
    try {
      res = JSON.parse(run(req.code, c.stdin ?? "", c.call ? JSON.stringify(c.call) : "", req.limits.outputChars));
    } catch (e) {
      res = { status: "error", stdout: "", stderr: "", truncated: false, error: { type: "InternalError", message: String(e?.message ?? e).slice(0, 300) } };
    }
    res.id = c.id;
    res.durationMs = Date.now() - started;
    send({ t: "case", ...res });
  }
}

// ───────────────────────── SQL (sql.js) ─────────────────────────
const DANGEROUS = /^\s*(ATTACH|DETACH|VACUUM\s+INTO)\b|load_extension/i;
const MAX_SHOWN = 500;

function allRows(db, sql) {
  const r = db.exec(sql)[0];
  return r ? { columns: r.columns, rows: r.values.slice(0, 2000) } : { columns: [], rows: [] };
}

function runScript(SQL, setupSql, script, checks, readOnly) {
  const db = new SQL.Database();
  const out = { statements: [], checks: [], schema: [] };
  try {
    db.run("PRAGMA foreign_keys = ON; PRAGMA max_page_count = 5000;");
    if (setupSql && setupSql.trim()) db.run(setupSql);
    if (readOnly) db.run("PRAGMA query_only = 1;");
    let lastSql = null;
    try {
      for (const stmt of db.iterateStatements(script)) {
        const sql = stmt.getSQL().trim();
        if (!sql) {
          stmt.free();
          continue;
        }
        if (DANGEROUS.test(sql)) {
          out.error = { type: "Interdit", message: "Instruction non autorisée dans l'environnement pédagogique (ATTACH, DETACH, VACUUM INTO, extension)." };
          stmt.free();
          break;
        }
        const item = { sql: sql.slice(0, 500) };
        const cols = stmt.getColumnNames();
        if (cols.length > 0) {
          const data = [];
          let total = 0;
          while (stmt.step()) {
            total++;
            if (data.length < MAX_SHOWN) data.push(stmt.get());
            if (total >= 20000) break;
          }
          item.columns = cols;
          item.rows = data;
          item.rowCount = total;
          lastSql = sql;
        } else {
          stmt.step();
          item.changes = db.getRowsModified();
        }
        stmt.free();
        out.statements.push(item);
      }
    } catch (e) {
      out.error = { type: "SQLError", message: String(e?.message ?? e).slice(0, 400) };
    }
    if (lastSql && !out.error) {
      try {
        out.lastSelect = allRows(db, lastSql);
      } catch {}
    }
    for (const q of checks) {
      try {
        out.checks.push(allRows(db, q));
      } catch (e) {
        out.checks.push({ columns: [], rows: [], error: String(e?.message ?? e).slice(0, 200) });
      }
    }
    try {
      const t = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0];
      for (const [name] of t?.values ?? []) {
        const q = `"${String(name).replace(/"/g, '""')}"`;
        const ti = db.exec(`PRAGMA table_info(${q})`)[0];
        const fk = db.exec(`PRAGMA foreign_key_list(${q})`)[0];
        out.schema.push({
          name,
          columns: (ti?.values ?? []).map((r) => ({ name: r[1], type: r[2], notNull: !!r[3], pk: !!r[5] })),
          foreignKeys: (fk?.values ?? []).map((r) => ({ from: r[3], table: r[2], to: r[4] })),
        });
      }
    } catch {}
  } finally {
    db.close();
  }
  return out;
}

async function sqlEngine(req) {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();
  lockdown();
  send({ t: "ready" });
  for (const c of req.cases) {
    const started = Date.now();
    const res = { id: c.id, status: "ok", durationMs: 0 };
    try {
      res.user = runScript(SQL, c.setupSql, c.script, c.checks ?? [], c.readOnly);
      if (c.reference != null) res.expected = runScript(SQL, c.setupSql, c.reference, c.checks ?? [], false);
    } catch (e) {
      res.status = "error";
      res.error = { type: "InternalError", message: String(e?.message ?? e).slice(0, 300) };
    }
    res.durationMs = Date.now() - started;
    send({ t: "case", ...res });
  }
}

// ───────────────────────── main ─────────────────────────
const req = JSON.parse(await readStdin());
NONCE = String(req.nonce ?? "");
try {
  if (req.engine === "javascript") await jsEngine(req);
  else if (req.engine === "python") await pyEngine(req);
  else if (req.engine === "sql") await sqlEngine(req);
  else throw new Error("moteur inconnu");
  send({ t: "done" });
} catch (e) {
  send({ t: "fatal", message: String(e?.message ?? e).slice(0, 300) });
}
proc.exit(0);
