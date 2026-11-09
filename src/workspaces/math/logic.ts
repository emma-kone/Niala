import { all, create } from "mathjs";
import type { MathPart, MathReference, MathWork } from "./model";

// ─────────────────────────────────────────────────────────────────────────────
// Vérification mathématique : équivalence d'expressions et d'équations par évaluation numérique en plusieurs points
// (une preuve de non-équivalence, ou un indice fort d'équivalence : jamais une démonstration formelle), contrôle des
// étapes consécutives, comparaison au résultat attendu et tracé de fonctions.
// ─────────────────────────────────────────────────────────────────────────────

const math = create(all, {});
// Lecture de l'arbre d'expression : référence gardée AVANT la désactivation de `parse` pour les expressions saisies.
const parseExpression = math.parse.bind(math);
// Le moteur d'expressions n'a besoin d'aucune fonction capable de modifier l'environnement.
math.import(
  {
    import: () => { throw new Error("Fonction désactivée"); },
    createUnit: () => { throw new Error("Fonction désactivée"); },
    reviver: () => { throw new Error("Fonction désactivée"); },
    evaluate: () => { throw new Error("Fonction désactivée"); },
    parse: () => { throw new Error("Fonction désactivée"); },
    simplify: () => { throw new Error("Fonction désactivée"); },
    derivative: () => { throw new Error("Fonction désactivée"); },
  },
  { override: true },
);
const compile = (expr: string) => parseExpression(expr).compile();
const MAX_LEN = 500;
const CONSTANTS = new Set(["pi", "e", "i", "Infinity", "NaN", "true", "false"]);

/** Expression saisie → syntaxe du moteur (symboles usuels, « ² » et « × » …). */
export function clean(expr: string): string {
  return expr
    .replace(/[×·⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/π/g, "pi")
    .replace(/√/g, "sqrt")
    .replace(/\\left|\\right/g, "")
    .trim();
}

export function variablesOf(expr: string): string[] {
  try {
    const names = new Set<string>();
    parseExpression(clean(expr)).traverse((n, _p, parent) => {
      const node = n as { type: string; name?: string };
      if (node.type === "SymbolNode" && node.name && !CONSTANTS.has(node.name) && !((parent as { type?: string } | null)?.type === "FunctionNode" && (parent as { fn?: unknown }).fn === n)) {
        if (!(node.name in (math as unknown as Record<string, unknown>)) || node.name.length === 1) names.add(node.name);
      }
    });
    return [...names];
  } catch {
    return [];
  }
}

/** Variables d'une expression ou d'une équation (« a = b » est lue côté par côté). */
export function variablesIn(s: string): string[] {
  const eq = splitEquation(s);
  return [...new Set(eq ? [...variablesOf(eq[0]), ...variablesOf(eq[1])] : variablesOf(s))];
}

export function numberAt(expr: string, scope: Record<string, number> = {}): number | null {
  if (!expr.trim() || expr.length > MAX_LEN) return null;
  try {
    const v = compile(clean(expr)).evaluate({ ...scope });
    const n = typeof v === "number" ? v : typeof v?.re === "number" && Math.abs(v.im ?? 0) < 1e-12 ? v.re : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Une expression est-elle compréhensible par le moteur ? */
export function parsable(expr: string): boolean {
  if (!expr.trim() || expr.length > MAX_LEN) return false;
  try {
    parseExpression(clean(expr));
    return true;
  } catch {
    return false;
  }
}

const SAMPLES = [-3.7, -2.3, -1.1, -0.45, 0.35, 0.8, 1.45, 2.2, 3.1, 4.3, 5.9, 7.2];
const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * (1 + Math.max(Math.abs(a), Math.abs(b)));

/** Deux expressions ont-elles les mêmes valeurs ? `null` : on ne peut pas conclure (syntaxe ou domaine). */
export function equivalent(a: string, b: string): boolean | null {
  if (!parsable(a) || !parsable(b)) return null;
  const vars = [...new Set([...variablesOf(a), ...variablesOf(b)])].slice(0, 3);
  if (vars.length === 0) {
    const x = numberAt(a);
    const y = numberAt(b);
    return x === null || y === null ? null : near(x, y);
  }
  let compared = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const scope = Object.fromEntries(vars.map((v, k) => [v, SAMPLES[(i + k * 5) % SAMPLES.length]]));
    const x = numberAt(a, scope);
    const y = numberAt(b, scope);
    if (x === null || y === null) continue;
    compared++;
    if (!near(x, y)) return false;
  }
  return compared >= 4 ? true : null;
}

export function splitEquation(s: string): [string, string] | null {
  const parts = s.split("=");
  return parts.length === 2 && parts[0].trim() && parts[1].trim() ? [parts[0], parts[1]] : null;
}

/** Deux équations ont-elles la même différence gauche − droite, à un facteur constant près ? */
export function equationsEquivalent(e1: string, e2: string): boolean | null {
  const a = splitEquation(e1);
  const b = splitEquation(e2);
  if (!a || !b) return null;
  const d1 = `(${a[0]}) - (${a[1]})`;
  const d2 = `(${b[0]}) - (${b[1]})`;
  if (!parsable(d1) || !parsable(d2)) return null;
  const vars = [...new Set([...variablesOf(d1), ...variablesOf(d2)])].slice(0, 3);
  let ratio: number | null = null;
  let compared = 0;
  for (let i = 0; i < SAMPLES.length; i++) {
    const scope = Object.fromEntries(vars.map((v, k) => [v, SAMPLES[(i + k * 5) % SAMPLES.length]]));
    const x = numberAt(d1, scope);
    const y = numberAt(d2, scope);
    if (x === null || y === null) continue;
    if (Math.abs(y) < 1e-9 && Math.abs(x) < 1e-9) {
      compared++;
      continue;
    }
    if (Math.abs(y) < 1e-9 || Math.abs(x) < 1e-9) return false;
    const r = x / y;
    if (ratio === null) ratio = r;
    else if (!near(ratio, r)) return false;
    compared++;
  }
  return compared >= 4 ? true : null;
}

export interface StepProblem {
  index: number;
  kind: "calcul" | "methode";
  message: string;
}

/** Première étape incohérente avec la précédente. Une erreur sur des nombres seuls est un « calcul » ; sur des expressions littérales, une « méthode ». */
export function firstStepProblem(steps: { ascii: string }[]): StepProblem | null {
  const list = steps.map((s) => s.ascii.trim());
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const cur = list[i];
    if (!prev || !cur) continue;
    const eq = prev.includes("=") && cur.includes("=");
    const ok = eq ? equationsEquivalent(prev, cur) : !prev.includes("=") && !cur.includes("=") ? equivalent(prev, cur) : null;
    if (ok === false) {
      const numeric = variablesIn(prev).length === 0 && variablesIn(cur).length === 0;
      return { index: i, kind: numeric ? "calcul" : "methode", message: numeric ? `L'étape ${i + 1} ne vaut pas la même chose que l'étape ${i} : un calcul est faux.` : `L'étape ${i + 1} n'est pas équivalente à l'étape ${i} : la transformation appliquée n'est pas valide.` };
    }
  }
  return null;
}

/** Valeurs candidates d'un résultat saisi : « x = 3 » → 3, « x = 1 ou x = 2 », ou l'expression elle-même. */
export function candidates(result: string): string[] {
  return result
    .split(/\s+(?:ou|or|;)\s+|;/i)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const eq = splitEquation(r);
      return eq && /^[a-zA-Z]\w*$/.test(eq[0].trim()) ? eq[1].trim() : r;
    });
}

export function matchesAnswer(result: string, answers: string[]): boolean {
  const given = candidates(result);
  if (given.length === 0) return false;
  const wanted = answers.flatMap((a) => candidates(a));
  // Toutes les solutions attendues doivent être données, sans valeur fausse en plus.
  return wanted.every((w) => given.some((g) => equivalent(g, w) === true)) && given.every((g) => wanted.some((w) => equivalent(g, w) === true));
}

export interface MathCheck {
  label: string;
  ok: boolean;
  detail?: string;
}
export interface MathGrade {
  ratio: number;
  checks: MathCheck[];
  problems: { part: string; problem: StepProblem }[];
}

const partResult = (p: MathPart) => p.result.ascii.trim() || p.steps.filter((s) => s.ascii.trim()).at(-1)?.ascii.trim() || "";

/** Note d'une production : résultat (60 %) et cohérence des étapes (40 %), partie par partie. Sans résultat de référence, seule la cohérence est jugée. */
export function gradeMath(work: MathWork, ref: MathReference | null): MathGrade {
  const checks: MathCheck[] = [];
  const problems: MathGrade["problems"] = [];
  let total = 0;
  let got = 0;
  work.parts.forEach((part, i) => {
    const target = ref?.parts[i];
    const weight = target?.points ?? 1;
    const label = part.label || `Question ${i + 1}`;
    const filled = part.steps.filter((s) => s.ascii.trim());
    const problem = firstStepProblem(filled);
    if (problem) problems.push({ part: label, problem });
    const stepsScore = filled.length === 0 ? 0 : problem ? Math.max(0, problem.index / filled.length) : 1;
    const result = partResult(part);
    if (target) {
      const ok = !!result && matchesAnswer(result, target.answers);
      checks.push({ label: `${label} : résultat final`, ok, detail: ok ? undefined : result ? "ne correspond pas au résultat attendu" : "aucun résultat" });
      checks.push({ label: `${label} : étapes cohérentes`, ok: filled.length > 0 && !problem, detail: problem?.message ?? (filled.length ? undefined : "aucune étape détaillée") });
      got += weight * (0.6 * (ok ? 1 : 0) + 0.4 * (ok && filled.length === 0 ? 0.5 : stepsScore));
    } else {
      checks.push({ label: `${label} : étapes cohérentes`, ok: filled.length > 0 && !problem, detail: problem?.message });
      got += weight * stepsScore;
    }
    total += weight;
  });
  if (ref?.graph && !(work.graph?.functions.some((f) => f.ascii.trim()))) checks.push({ label: "Graphique demandé", ok: false, detail: "aucune fonction tracée" });
  return { ratio: total ? Math.max(0, Math.min(1, got / total)) : 0, checks, problems };
}

export const isMathEmpty = (w: MathWork) => w.parts.every((p) => !p.steps.some((s) => s.ascii.trim() || s.latex.trim()) && !p.result.ascii.trim() && !p.result.latex.trim()) && !w.graph?.functions.some((f) => f.ascii.trim());

// ── Tracé ────────────────────────────────────────────────────────────────────

export interface PlotPoint {
  x: number;
  y: number | null;
}
/** Échantillonne f(x) ; y = null aux points non définis (coupure de la courbe). */
export function sampleFunction(expr: string, xmin: number, xmax: number, n = 400): PlotPoint[] {
  if (!parsable(expr) || !(xmax > xmin)) return [];
  const v = variablesOf(expr)[0] ?? "x";
  const fn = (() => {
    try {
      return compile(clean(expr));
    } catch {
      return null;
    }
  })();
  if (!fn) return [];
  const out: PlotPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const x = xmin + ((xmax - xmin) * i) / n;
    let y: number | null = null;
    try {
      const r = fn.evaluate({ [v]: x });
      y = typeof r === "number" && Number.isFinite(r) ? r : null;
    } catch {
      y = null;
    }
    out.push({ x, y });
  }
  return out;
}
