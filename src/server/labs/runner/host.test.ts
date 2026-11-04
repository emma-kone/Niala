import { describe, expect, it } from "vitest";
import { runCodeCases, runSqlCases } from "./host";

// Ces tests lancent de vrais processus isolés (QuickJS, Pyodide, sql.js) : aucune simulation.
const fast = { caseTimeoutMs: 3000, totalBudgetMs: 60_000 };

describe("runner JavaScript (QuickJS)", () => {
  it("exécute, capture la sortie et appelle une fonction", async () => {
    const r = await runCodeCases("javascript", "console.log('salut'); function add(a,b){return a+b}", [{ id: "a", call: { fn: "add", args: [2, 3] } }, { id: "b" }], fast);
    expect(r.unavailable).toBeUndefined();
    expect(r.results[0]).toMatchObject({ status: "ok", returned: 5, stdout: "salut\n" });
    expect(r.results[1]).toMatchObject({ status: "ok", stdout: "salut\n" });
  }, 60_000);

  it("transpile le TypeScript et lit stdin", async () => {
    const code = "const n: number = Number(readLine()); console.log(n * 2 as number);";
    const r = await runCodeCases("typescript", code, [{ id: "a", stdin: "21\n" }], fast);
    expect(r.results[0]).toMatchObject({ status: "ok", stdout: "42\n" });
  }, 60_000);

  it("signale les erreurs de syntaxe et d'exécution avec leur ligne", async () => {
    const syn = await runCodeCases("javascript", "let x = ;", [{ id: "a" }], fast);
    expect(syn.results[0].status).toBe("error");
    expect(syn.results[0].error?.type).toBe("SyntaxError");
    const rt = await runCodeCases("javascript", "const a = 1;\nundefinedFn();", [{ id: "a" }], fast);
    expect(rt.results[0].error).toMatchObject({ type: "ReferenceError", line: 2 });
  }, 60_000);

  it("interrompt une boucle infinie, puis exécute les cas suivants", async () => {
    const code = "function f(x){ if (x === 0) { while(true){} } return x; }";
    const r = await runCodeCases("javascript", code, [{ id: "a", call: { fn: "f", args: [1] } }, { id: "b", call: { fn: "f", args: [0] } }, { id: "c", call: { fn: "f", args: [3] } }], fast);
    expect(r.results.map((x) => x.status)).toEqual(["ok", "timeout", "ok"]);
    expect(r.results[2].returned).toBe(3);
  }, 60_000);

  it("n'expose ni process, ni require, ni fetch, ni l'environnement du serveur", async () => {
    process.env.SECRET_LAB_TEST = "ne-doit-jamais-fuiter";
    const code = "console.log(typeof process, typeof require, typeof fetch, typeof globalThis.constructor.constructor);";
    const r = await runCodeCases("javascript", code, [{ id: "a" }], fast);
    expect(r.results[0].stdout).toContain("undefined undefined undefined");
    expect(r.results[0].stdout).not.toContain("ne-doit-jamais-fuiter");
    delete process.env.SECRET_LAB_TEST;
  }, 60_000);

  it("borne la mémoire et la sortie", async () => {
    const mem = await runCodeCases("javascript", "const a = []; while (true) a.push(new Array(100000).fill(1));", [{ id: "a" }], fast);
    expect(["memory", "error", "timeout"]).toContain(mem.results[0].status);
    const out = await runCodeCases("javascript", "for (let i=0;i<200000;i++) console.log('xxxxxxxxxx'+i);", [{ id: "a" }], { ...fast, outputChars: 1000 });
    expect(out.results[0].stdout.length).toBeLessThan(1100);
    expect(out.results[0].truncated).toBe(true);
  }, 60_000);
});

describe("runner Python (Pyodide)", () => {
  it("exécute, lit stdin, appelle une fonction, classe les erreurs", async () => {
    const code = "def double(x):\n    return x * 2\nname = input()\nprint('Bonjour', name)";
    const r = await runCodeCases("python", code, [{ id: "a", stdin: "Ana\n" }, { id: "b", call: { fn: "double", args: [4] }, stdin: "x\n" }], fast);
    expect(r.unavailable).toBeUndefined();
    expect(r.results[0]).toMatchObject({ status: "ok", stdout: "Bonjour Ana\n" });
    expect(r.results[1].returned).toBe(8);
    const err = await runCodeCases("python", "x = 1\nprint(1/0)", [{ id: "a" }], fast);
    expect(err.results[0].error).toMatchObject({ type: "ZeroDivisionError", line: 2 });
    const syn = await runCodeCases("python", "def f(:\n  pass", [{ id: "a" }], fast);
    expect(syn.results[0].error?.type).toBe("SyntaxError");
  }, 120_000);

  it("interrompt une boucle infinie", async () => {
    const r = await runCodeCases("python", "while True:\n    pass", [{ id: "a" }, { id: "b" }], { ...fast, caseTimeoutMs: 2500 });
    expect(r.results[0].status).toBe("timeout");
    expect(r.results[1].status).toBe("timeout");
  }, 120_000);

  it("ne voit ni le disque du serveur, ni les secrets, ni le réseau, ni process", async () => {
    process.env.SECRET_LAB_TEST = "ne-doit-jamais-fuiter";
    const code = [
      "import js, os",
      "def probe(label, fn):",
      "    try:",
      "        print(label, 'OK', str(fn())[:60])",
      "    except BaseException as e:",
      "        print(label, 'BLOQUE', type(e).__name__)",
      "probe('process', lambda: js.process)",
      "probe('fetch', lambda: js.fetch)",
      "probe('require', lambda: js.require)",
      "probe('fichier', lambda: open('C:/Users/konee/Desktop/site2V1/package.json').read())",
      "probe('env', lambda: os.environ.get('SECRET_LAB_TEST'))",
      "probe('socket', lambda: __import__('socket').create_connection(('example.com', 80), 2))",
      "probe('subprocess', lambda: __import__('subprocess').run(['echo', 'x']))",
    ].join("\n");
    const r = await runCodeCases("python", code, [{ id: "a" }], fast);
    const out = r.results[0].stdout;
    expect(out).toContain("process BLOQUE");
    expect(out).toContain("fetch BLOQUE");
    expect(out).toContain("require BLOQUE");
    expect(out).toContain("fichier BLOQUE");
    expect(out).toContain("socket BLOQUE");
    expect(out).toContain("subprocess BLOQUE");
    expect(out).not.toContain("ne-doit-jamais-fuiter");
    delete process.env.SECRET_LAB_TEST;
  }, 120_000);
});

describe("runner SQL (sql.js)", () => {
  const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY, n TEXT); INSERT INTO t(n) VALUES ('a'),('b'),('c');";

  it("exécute un script, renvoie résultats et schéma, compare à la référence", async () => {
    const r = await runSqlCases([{ id: "a", setupSql: setup, script: "SELECT n FROM t ORDER BY id DESC;", reference: "SELECT n FROM t ORDER BY id DESC;" }], fast);
    expect(r.unavailable).toBeUndefined();
    const c = r.results[0];
    expect(c.user?.lastSelect?.rows).toEqual([["c"], ["b"], ["a"]]);
    expect(c.expected?.lastSelect?.rows).toEqual([["c"], ["b"], ["a"]]);
    expect(c.user?.schema[0]).toMatchObject({ name: "t" });
  }, 60_000);

  it("renvoie l'erreur SQL au lieu de planter, et bloque ATTACH", async () => {
    const r = await runSqlCases([{ id: "a", setupSql: setup, script: "SELECT * FROM inconnue;" }, { id: "b", setupSql: setup, script: "ATTACH DATABASE 'x.db' AS x;" }], fast);
    expect(r.results[0].user?.error?.message).toMatch(/no such table/i);
    expect(r.results[1].user?.error?.type).toBe("Interdit");
  }, 60_000);

  it("refuse les PRAGMA de configuration (plafond mémoire non contournable), y compris après un commentaire ou dans l'installation", async () => {
    const blob = "CREATE TABLE b(x); INSERT INTO b VALUES (zeroblob(40000000));";
    const r = await runSqlCases(
      [
        { id: "a", setupSql: setup, script: "PRAGMA max_page_count=1000000; " + blob },
        { id: "b", setupSql: setup, script: "/* x */ PRAGMA max_page_count=1000000; " + blob },
        { id: "c", setupSql: "PRAGMA max_page_count=1000000;", script: blob },
        { id: "d", setupSql: setup, script: "PRAGMA table_info(t);" },
      ],
      fast,
    );
    expect(r.results[0].user?.error?.type).toBe("Interdit");
    expect(r.results[1].user?.error?.type).toBe("Interdit");
    expect(r.results[2].status).toBe("error");
    expect(r.results[2].error?.message).toMatch(/installation/);
    expect(r.results[3].user?.error).toBeUndefined();
  }, 60_000);

  it("interrompt une requête infinie (récursion) sans bloquer le serveur", async () => {
    const r = await runSqlCases(
      [{ id: "a", setupSql: setup, script: "WITH RECURSIVE r(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM r) SELECT count(*) FROM r;" }, { id: "b", setupSql: setup, script: "SELECT count(*) FROM t;" }],
      { ...fast, caseTimeoutMs: 2500 },
    );
    expect(r.results[0].status).toBe("timeout");
    expect(r.results[1].user?.lastSelect?.rows).toEqual([[3]]);
  }, 60_000);
});
