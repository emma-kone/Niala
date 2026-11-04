// Analyse statique « en direct » du code de l'étudiant : règles pures, sans exécution du code.
// Seuls des OUTILS vérifient la validité (analyseur de syntaxe, compilateur Python en mode compilation seule,
// SQLite via EXPLAIN). L'IA n'intervient jamais ici : une erreur signalée est une erreur certaine.

export type ProblemSeverity = "error" | "warning";

export interface CodeProblem {
  line: number;
  column?: number;
  severity: ProblemSeverity;
  /** syntax : règle du langage violée · structure : délimiteurs mal appariés · environment : bibliothèque ou limite · unsupported : langage non exécutable */
  kind: "syntax" | "structure" | "environment" | "unsupported";
  message: string;
  /** Pourquoi c'est incorrect et comment corriger, quand une règle connue s'applique. */
  hint?: string;
  /** Outil qui a produit ce constat. */
  source: "sucrase" | "python" | "sqlite" | "brackets";
}

export type AnalysisSummary = "ok" | "syntax_error" | "not_executable" | "unavailable" | "empty";

export interface CodeAnalysis {
  language: string;
  /** Le langage peut-il être exécuté dans Niala ? */
  executable: boolean;
  /** Raison lorsque le code ne peut pas être exécuté ici. */
  executableReason?: string;
  /** compiler : validé par l'analyseur du langage · form : simple contrôle des délimiteurs · none : rien vérifié */
  verification: "compiler" | "form" | "none";
  summary: AnalysisSummary;
  problems: CodeProblem[];
  durationMs: number;
}

// ── JavaScript / TypeScript (erreurs de sucrase) ─────────────────────────────

export function parseSucraseError(e: unknown): CodeProblem {
  const err = e as { message?: string; loc?: { line: number; column: number } };
  const raw = String(err?.message ?? "Erreur de syntaxe");
  const m = /\((\d+):(\d+)\)\s*$/.exec(raw);
  const line = err.loc?.line ?? (m ? Number(m[1]) : 1);
  const column = err.loc ? err.loc.column + 1 : m ? Number(m[2]) + 1 : undefined;
  const message = raw.replace(/\s*\(\d+:\d+\)\s*$/, "");
  return { line, column, severity: "error", kind: "syntax", message, hint: explainSyntax("javascript", message), source: "sucrase" };
}

// ── Python (compile() sans exécuter) ─────────────────────────────────────────

/** Programme Python exécuté dans le runner isolé : il COMPILE le code de l'étudiant sans jamais l'exécuter. */
export function pythonCheckProgram(code: string): string {
  return [
    "import json",
    `SRC = ${JSON.stringify(code)}`,
    "try:",
    '    compile(SRC, "<code>", "exec")',
    '    print("@@CHK@@" + json.dumps({"ok": True}))',
    "except SyntaxError as e:",
    '    print("@@CHK@@" + json.dumps({"ok": False, "line": e.lineno or 1, "col": e.offset, "msg": e.msg or "invalid syntax", "type": type(e).__name__}))',
    "except Exception as e:",
    '    print("@@CHK@@" + json.dumps({"ok": False, "line": 1, "col": None, "msg": str(e), "type": type(e).__name__}))',
  ].join("\n");
}

export function parsePythonCheck(stdout: string): CodeProblem | "ok" | null {
  const line = stdout.split("\n").find((l) => l.startsWith("@@CHK@@"));
  if (!line) return null;
  try {
    const r = JSON.parse(line.slice(7)) as { ok: boolean; line?: number; col?: number | null; msg?: string; type?: string };
    if (r.ok) return "ok";
    const message = `${r.type && r.type !== "SyntaxError" ? `${r.type} : ` : ""}${r.msg ?? "invalid syntax"}`;
    return { line: Math.max(1, r.line ?? 1), column: r.col ?? undefined, severity: "error", kind: "syntax", message, hint: explainSyntax("python", `${r.type ?? ""} ${r.msg ?? ""}`), source: "python" };
  } catch {
    return null;
  }
}

// ── SQL (EXPLAIN de chaque instruction, sans l'exécuter) ─────────────────────

/** Découpe un script SQL en instructions, sans couper dans une chaîne ou un commentaire. */
export function splitSqlStatements(sql: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let cur = "";
  let line = 1;
  let startLine = 1;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const n = sql[i + 1];
    if (c === "\n") line++;
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      line++;
      cur += "\n";
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        if (sql[i] === "\n") line++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === ";") {
      if (cur.trim()) out.push({ text: cur.trim(), line: startLine });
      cur = "";
      startLine = line;
      continue;
    }
    if (!cur.trim() && !/\s/.test(c)) startLine = line;
    cur += c;
  }
  if (cur.trim()) out.push({ text: cur.trim(), line: startLine });
  return out;
}

/** Instructions qu'EXPLAIN peut valider sans les exécuter (le reste est ignoré : pas d'avis sans outil fiable). */
export const EXPLAINABLE = /^(select|with|insert|update|delete|replace)\b/i;

// ── Délimiteurs (langages non exécutables : contrôle de forme seulement) ─────

/** Parenthèses, crochets et accolades appariés, en ignorant chaînes, caractères et commentaires. */
export function checkBrackets(code: string): CodeProblem[] {
  const problems: CodeProblem[] = [];
  const stack: { ch: string; line: number; column: number }[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  let line = 1;
  let col = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const n = code[i + 1];
    col++;
    if (c === "\n") {
      line++;
      col = 0;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      i--;
      continue;
    }
    if (c === "/" && n === "*") {
      const startLine = line;
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") line++;
        i++;
      }
      if (i >= code.length) problems.push({ line: startLine, severity: "error", kind: "structure", message: "Commentaire /* … */ jamais refermé.", source: "brackets" });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const startLine = line;
      let closed = false;
      for (i++; i < code.length && code[i] !== "\n"; i++) {
        if (code[i] === "\\") i++;
        else if (code[i] === c) {
          closed = true;
          break;
        }
      }
      if (!closed) {
        problems.push({ line: startLine, severity: "error", kind: "structure", message: c === '"' ? "Chaîne de caractères non terminée (guillemet fermant manquant)." : "Caractère ou chaîne entre apostrophes non terminé.", source: "brackets" });
        i--;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push({ ch: c, line, column: col });
    else if (c === ")" || c === "]" || c === "}") {
      const top = stack.pop();
      if (!top || top.ch !== pairs[c]) {
        problems.push({ line, column: col, severity: "error", kind: "structure", message: `« ${c} » sans « ${pairs[c]} » correspondant.`, source: "brackets" });
        if (top) stack.push(top);
      }
    }
  }
  for (const open of stack) problems.push({ line: open.line, column: open.column, severity: "error", kind: "structure", message: `« ${open.ch} » ouvert ici n'est jamais refermé.`, source: "brackets" });
  return problems.sort((a, b) => a.line - b.line).slice(0, 20);
}

// ── Explications des erreurs de syntaxe courantes (règle, cause, correction) ──

const PY_HINTS: [RegExp, string][] = [
  [/expected ':'/i, "Une instruction composée (if, for, while, def, class, else…) doit se terminer par deux-points « : » avant son bloc indenté."],
  [/was never closed/i, "Une parenthèse, un crochet ou une accolade ouvert n'est jamais refermé : vérifiez l'appariement, souvent sur la ligne indiquée ou juste avant."],
  [/unterminated string/i, "Une chaîne de caractères n'est pas fermée : ajoutez le guillemet fermant, sur la même ligne."],
  [/unexpected indent|IndentationError.*unexpected/i, "Cette ligne est plus indentée que la précédente sans raison : en Python, l'indentation délimite les blocs et doit être cohérente."],
  [/expected an indented block|IndentationError/i, "Après « : », le bloc doit être indenté (4 espaces conseillés) ; alignez les lignes d'un même bloc."],
  [/unindent does not match/i, "L'indentation de cette ligne ne correspond à aucun bloc ouvert : utilisez la même indentation que les lignes du même bloc."],
  [/invalid syntax/i, "Python ne comprend pas cette instruction. Cherchez un mot-clé mal écrit, un opérateur manquant ou une ligne incomplète juste avant."],
  [/cannot assign to/i, "À gauche d'un « = » il faut un nom de variable ; pour comparer, utilisez « == »."],
  [/Missing parentheses in call to 'print'/i, "En Python 3, print est une fonction : écrivez print(…)."],
];

const JS_HINTS: [RegExp, string][] = [
  [/expected "[,;)}\]]"/i, "Un séparateur ou un délimiteur est attendu ici : vérifiez les virgules, parenthèses et accolades fermantes juste avant."],
  [/unexpected token/i, "Un symbole se trouve à un endroit où le langage ne l'attend pas : cherchez une valeur manquante, un opérateur en trop ou une instruction incomplète."],
  [/unterminated string/i, "Une chaîne de caractères n'est pas fermée : ajoutez le guillemet fermant."],
  [/unexpected end of input|unexpected eof/i, "Le code se termine trop tôt : une parenthèse ou une accolade ouverte n'a pas été refermée."],
  [/missing semicolon|unexpected keyword/i, "Une instruction est mal terminée ou un mot-clé est mal placé."],
];

export function explainSyntax(language: string, message: string): string | undefined {
  const table = language === "python" ? PY_HINTS : JS_HINTS;
  return table.find(([re]) => re.test(message))?.[1];
}

// ── SQLite : explications des messages usuels ────────────────────────────────

export function explainSqlError(message: string): string | undefined {
  if (/misuse of aggregate/i.test(message)) return "Une fonction d'agrégation (COUNT, SUM, AVG…) ne peut pas servir dans WHERE, qui filtre les lignes avant le regroupement. Pour filtrer sur un agrégat, utilisez HAVING après GROUP BY.";
  if (/no such table/i.test(message)) return "Cette table n'existe pas dans la base : vérifiez son nom exact dans le schéma affiché.";
  if (/no such column/i.test(message)) return "Cette colonne n'existe pas (ou pas dans cette table) : vérifiez son nom dans le schéma et le préfixe de table.";
  if (/ambiguous column/i.test(message)) return "Ce nom de colonne existe dans plusieurs tables de la requête : préfixez-le par le nom ou l'alias de la table.";
  if (/syntax error|incomplete input|unrecognized token/i.test(message)) return "La requête est mal formée : vérifiez l'ordre des clauses (SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY), les virgules et les parenthèses.";
  return undefined;
}
