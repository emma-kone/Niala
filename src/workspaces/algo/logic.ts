import type { AlgoLanguage } from "./model";

// ─────────────────────────────────────────────────────────────────────────────
// Vérification de structure d'un algorithme en pseudo-code (formalisme français usuel) : blocs ouverts/fermés,
// mots-clés attendus, affectations, variables. Ce n'est pas un interpréteur : il repère les fautes de forme, pas de logique.
// ─────────────────────────────────────────────────────────────────────────────

export interface AlgoIssue {
  line: number;
  level: "error" | "warning" | "info";
  message: string;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const strip = (line: string) => line.replace(/\/\/.*$|\{[^}]*\}|\(\*.*?\*\)/g, "").replace(/"[^"]*"/g, '""').trim();

interface Block {
  kind: "algo" | "debut" | "si" | "pour" | "tantque" | "repeter" | "selon" | "fonction" | "procedure";
  line: number;
}
const CLOSERS: Record<string, Block["kind"]> = { finsi: "si", finpour: "pour", fintantque: "tantque", finselon: "selon", finfonction: "fonction", finprocedure: "procedure" };
const NAME: Record<Block["kind"], string> = { algo: "Algorithme", debut: "Début", si: "Si", pour: "Pour", tantque: "Tant que", repeter: "Répéter", selon: "Selon", fonction: "Fonction", procedure: "Procédure" };
const CLOSE_NAME: Record<Block["kind"], string> = { algo: "Fin", debut: "Fin", si: "FinSi", pour: "FinPour", tantque: "FinTantQue", repeter: "Jusqu'à", selon: "FinSelon", fonction: "FinFonction", procedure: "FinProcédure" };

export function lintPseudo(code: string): AlgoIssue[] {
  const out: AlgoIssue[] = [];
  const lines = code.split(/\r?\n/);
  const stack: Block[] = [];
  const declared = new Set<string>();
  const used = new Set<string>();
  let inVars = false;
  let sawStart = false;
  let sawHeader = false;
  const nonEmpty = lines.some((l) => strip(l));
  if (!nonEmpty) return [];

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = strip(raw);
    if (!line) return;
    const f = fold(line).replace(/\s+/g, " ");
    const word = f.match(/^[a-z]+/)?.[0] ?? "";
    const compact = f.replace(/ /g, "");

    if (/^algorithme\b/.test(f)) {
      sawHeader = true;
      stack.push({ kind: "algo", line: n });
      return;
    }
    if (/^(variables?|var|constantes?)\b/.test(f)) {
      inVars = true;
      const rest = line.replace(/^\S+\s*:?/, "");
      if (rest.trim()) declareLine(rest, declared);
      return;
    }
    if (/^debut\b/.test(f)) {
      inVars = false;
      sawStart = true;
      stack.push({ kind: "debut", line: n });
      return;
    }
    if (inVars) {
      if (/:/.test(line) || /\b(entier|reel|chaine|caractere|booleen|tableau)\b/.test(f)) declareLine(line, declared);
      return;
    }
    // Ouvertures
    if (/^(fonction|procedure)\b/.test(f)) {
      stack.push({ kind: word === "fonction" ? "fonction" : "procedure", line: n });
      return;
    }
    if (word === "si" && !/^si\s*\(.*\)\s*alors$/.test("") ) {
      if (!/\balors\b/.test(f)) out.push({ line: n, level: "error", message: "« Si » doit être suivi de « Alors »." });
      stack.push({ kind: "si", line: n });
      return;
    }
    if (word === "sinon" || compact.startsWith("sinonsi")) {
      if (stack.at(-1)?.kind !== "si") out.push({ line: n, level: "error", message: "« Sinon » sans « Si » correspondant." });
      return;
    }
    if (word === "pour") {
      if (!/\bfaire\b/.test(f)) out.push({ line: n, level: "error", message: "« Pour » doit se terminer par « Faire »." });
      if (!/\bde\b|<-|←|:=/.test(f) || !/\ba\b/.test(f)) out.push({ line: n, level: "warning", message: "Forme attendue : Pour i de 1 à n Faire." });
      stack.push({ kind: "pour", line: n });
      return;
    }
    if (/^tant ?que\b/.test(f)) {
      if (!/\bfaire\b/.test(f)) out.push({ line: n, level: "error", message: "« Tant que » doit se terminer par « Faire »." });
      stack.push({ kind: "tantque", line: n });
      return;
    }
    if (/^repeter\b/.test(f)) {
      stack.push({ kind: "repeter", line: n });
      return;
    }
    if (word === "selon") {
      stack.push({ kind: "selon", line: n });
      return;
    }
    // Fermetures
    const closing = compact.match(/^(finsi|finpour|fintantque|finselon|finfonction|finprocedure)$/)?.[1];
    if (closing) {
      const want = CLOSERS[closing];
      const top = stack.at(-1);
      if (!top) out.push({ line: n, level: "error", message: `« ${line} » ferme un bloc qui n'a pas été ouvert.` });
      else if (top.kind !== want) out.push({ line: n, level: "error", message: `« ${line} » ne correspond pas au bloc « ${NAME[top.kind]} » ouvert ligne ${top.line} (attendu : ${CLOSE_NAME[top.kind]}).` });
      else stack.pop();
      if (top && top.kind !== want && stack.some((b) => b.kind === want)) while (stack.length && stack.pop()!.kind !== want);
      return;
    }
    if (/^jusqu/.test(f)) {
      const top = stack.at(-1);
      if (top?.kind !== "repeter") out.push({ line: n, level: "error", message: "« Jusqu'à » sans « Répéter » correspondant." });
      else stack.pop();
      return;
    }
    if (word === "fin") {
      const top = stack.at(-1);
      if (!top) out.push({ line: n, level: "error", message: "« Fin » sans « Début » correspondant." });
      else if (top.kind === "debut" || top.kind === "algo") {
        stack.pop();
        if (top.kind === "debut" && stack.at(-1)?.kind === "algo") stack.pop();
      } else out.push({ line: n, level: "error", message: `« Fin » alors que le bloc « ${NAME[top.kind]} » (ligne ${top.line}) n'est pas fermé : il faut ${CLOSE_NAME[top.kind]}.` });
      return;
    }
    // Instructions
    const assign = line.match(/^([A-Za-zÀ-ÿ_][\wÀ-ÿ]*(?:\s*\[[^\]]*\])?)\s*(<-|←|:=|=)(?!=)\s*(.*)$/);
    if (assign) {
      if (assign[2] === "=") out.push({ line: n, level: "warning", message: "Pour une affectation, utilisez « ← » (ou « <- ») ; « = » sert aux comparaisons." });
      if (!assign[3].trim()) out.push({ line: n, level: "error", message: "Affectation sans valeur." });
      const v = fold(assign[1].replace(/\[.*$/, "").trim());
      if (declared.size && !declared.has(v)) out.push({ line: n, level: "warning", message: `La variable « ${assign[1].replace(/\[.*$/, "").trim()} » est utilisée sans avoir été déclarée.` });
      used.add(v);
      collect(assign[3], used);
      return;
    }
    const read = f.match(/^(lire|saisir)\s*\(?\s*([a-z_]\w*)/);
    if (read) {
      if (declared.size && !declared.has(read[2])) out.push({ line: n, level: "warning", message: `La variable « ${read[2]} » est lue sans avoir été déclarée.` });
      used.add(read[2]);
      return;
    }
    collect(line, used);
  });

  for (const b of stack) {
    if (b.kind === "algo" && sawStart) continue;
    out.push({ line: b.line, level: "error", message: `Le bloc « ${NAME[b.kind]} » ouvert ligne ${b.line} n'est pas fermé (${CLOSE_NAME[b.kind]} attendu).` });
  }
  if (!sawHeader) out.push({ line: 1, level: "info", message: "Pas d'en-tête « Algorithme … » : à ajouter si votre cours l'exige." });
  if (!sawStart && !/^\s*(fonction|procedure)/i.test(fold(code))) out.push({ line: 1, level: "info", message: "Aucun « Début » : le corps de l'algorithme n'est pas délimité." });
  for (const d of declared) if (!used.has(d)) out.push({ line: 1, level: "info", message: `La variable « ${d} » est déclarée mais jamais utilisée.` });
  return out.sort((a, b) => a.line - b.line);
}

function declareLine(line: string, set: Set<string>) {
  const names = fold(line.split(":")[0]).split(/[,\s]+/).filter((x) => /^[a-z_]\w*$/.test(x) && !["variables", "variable", "var", "constantes", "constante"].includes(x));
  for (const n of names) set.add(n);
}
function collect(expr: string, set: Set<string>) {
  for (const m of fold(expr).matchAll(/[a-z_]\w*/g)) set.add(m[0]);
}

/** Contrôles légers pour les autres langages : parenthèses, crochets, accolades et guillemets équilibrés. */
export function lintBrackets(code: string): AlgoIssue[] {
  const out: AlgoIssue[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: { ch: string; line: number }[] = [];
  const lines = code.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$|#.*$/, "");
    let quote: string | null = null;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (quote) {
        if (ch === "\\") k++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if ("([{".includes(ch)) stack.push({ ch, line: i + 1 });
      else if (pairs[ch]) {
        const top = stack.pop();
        if (!top || top.ch !== pairs[ch]) out.push({ line: i + 1, level: "error", message: `« ${ch} » sans « ${pairs[ch]} » correspondant.` });
      }
    }
    if (quote && quote !== "`") out.push({ line: i + 1, level: "error", message: "Chaîne de caractères non fermée." });
  });
  for (const o of stack) out.push({ line: o.line, level: "error", message: `« ${o.ch} » n'est jamais fermé.` });
  return out;
}

export const lintAlgo = (code: string, language: AlgoLanguage): AlgoIssue[] => (language === "pseudo" ? lintPseudo(code) : lintBrackets(code));
