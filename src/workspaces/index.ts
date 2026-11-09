import { z } from "zod";
import { lintAlgo } from "./algo/logic";
import { algoWorkSchema, readAlgo, ALGO_LANGUAGE_LABEL } from "./algo/model";
import { gradeMath, isMathEmpty } from "./math/logic";
import { mathWorkSchema, readMath } from "./math/model";
import { isMeriseEmpty } from "./merise/grade";
import { meriseIssues } from "./merise/logic";
import { meriseWorkSchema, readMerise } from "./merise/model";
import { isEnvironment, type WorkspaceEnvironment } from "./registry";

// ─────────────────────────────────────────────────────────────────────────────
// Interface commune des environnements pour le moteur d'exercices : valider, détecter le vide, résumer pour l'IA,
// contrôler. Le moteur ne connaît pas le détail de chaque discipline : il passe par ces fonctions.
// ─────────────────────────────────────────────────────────────────────────────

/** Environnements dont la production est un document structuré (les autres types de question gardent leur valeur d'origine). */
export const STRUCTURED_ENVIRONMENTS = ["merise", "math", "algo"] as const satisfies readonly WorkspaceEnvironment[];
export type StructuredEnvironment = (typeof STRUCTURED_ENVIRONMENTS)[number];
export const isStructured = (v: unknown): v is StructuredEnvironment => isEnvironment(v) && (STRUCTURED_ENVIRONMENTS as readonly string[]).includes(v);

/** Taille maximale d'une production enregistrée (JSON). */
export const MAX_WORK_BYTES = 400_000;

export function workspaceValueSchema(env: StructuredEnvironment): z.ZodType {
  return env === "merise" ? meriseWorkSchema : env === "math" ? mathWorkSchema : algoWorkSchema;
}

export function isWorkspaceFilled(env: unknown, value: unknown): boolean {
  if (!isStructured(env) || value == null || typeof value !== "object") return false;
  if (env === "merise") return !isMeriseEmpty(readMerise(value));
  if (env === "math") return !isMathEmpty(readMath(value));
  return readAlgo(value).code.trim().length > 0;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Résumé textuel d'une production, pour l'IA (tuteur, correction). */
export function describeWork(env: StructuredEnvironment, value: unknown): string {
  if (env === "algo") {
    const w = readAlgo(value);
    return `Langage : ${ALGO_LANGUAGE_LABEL[w.language]}\n${clip(w.code, 6000)}${w.lastRun ? `\nDernière exécution (${w.lastRun.ok ? "réussie" : "en erreur"}) : ${clip(w.lastRun.output, 500)}` : ""}`;
  }
  if (env === "math") {
    const w = readMath(value);
    return w.parts
      .map((p) => `${p.label || "Partie"} :\n${p.steps.filter((s) => s.ascii || s.latex).map((s, i) => `  ${i + 1}. ${s.ascii || s.latex}${s.note ? `   (${s.note})` : ""}`).join("\n") || "  (aucune étape)"}\n  Résultat : ${p.result.ascii || p.result.latex || "(non indiqué)"}`)
      .join("\n") + (w.graph?.functions.length ? `\nFonctions tracées : ${w.graph.functions.map((f) => f.ascii || f.latex).join(" ; ")}` : "");
  }
  const w = readMerise(value);
  const name = (id: string) => w.mcd.entities.find((e) => e.id === id)?.name || "?";
  const lines: string[] = [];
  if (w.dictionary.length) lines.push(`Dictionnaire : ${w.dictionary.map((d) => `${d.code}${d.nature === "calculee" ? " (calculée)" : ""} [${d.type}${d.size ? d.size : ""}]`).join(", ")}`);
  if (w.dependencies.length) lines.push(`Dépendances : ${w.dependencies.map((d) => `${d.from.join("+")} → ${d.to.join(", ")}`).join(" ; ")}`);
  if (w.mcd.entities.length || w.mcd.associations.length) {
    lines.push(`MCD entités : ${w.mcd.entities.map((e) => `${e.name} (${e.attributes.map((a) => (a.isId ? `#${a.name}` : a.name)).join(", ")})`).join(" ; ")}`);
    lines.push(`MCD associations : ${w.mcd.associations.map((a) => `${a.name || "?"} [${a.links.map((l) => `${name(l.entityId)} ${l.card}`).join(" – ")}]${a.attributes.length ? ` propriétés : ${a.attributes.map((x) => x.name).join(", ")}` : ""}`).join(" ; ")}`);
  }
  if (w.mld.tables.length) lines.push(`MLD : ${w.mld.tables.map((t) => `${t.name}(${t.columns.map((c) => (c.pk ? `#${c.name}` : c.fkTable ? `${c.name}→${c.fkTable}` : c.name)).join(", ")})`).join(" ; ")}`);
  if (w.mpd.tables.length) lines.push(`MPD : ${w.mpd.tables.map((t) => `${t.name}(${t.columns.map((c) => `${c.name} ${c.type}${c.size ? `(${c.size})` : ""}`).join(", ")})`).join(" ; ")}`);
  if (w.mct.nodes.length) lines.push(`MCT : ${w.mct.nodes.map((n) => `${n.kind}:${n.label}`).join(" ; ")} ; liens : ${w.mct.edges.length}`);
  if (w.flows.actors.length) lines.push(`Flux : acteurs ${w.flows.actors.map((a) => a.name).join(", ")} ; ${w.flows.flows.map((f) => `${w.flows.actors.find((a) => a.id === f.from)?.name ?? "?"}→${w.flows.actors.find((a) => a.id === f.to)?.name ?? "?"} (${f.label})`).join(" ; ")}`);
  return clip(lines.join("\n") || "(atelier vide)", 8000);
}

/** Contrôles automatiques de cohérence interne, indépendants de toute solution de référence. */
export function workspaceFindings(env: StructuredEnvironment, value: unknown): string[] {
  if (env === "merise") return meriseIssues(readMerise(value)).filter((i) => i.level !== "info").map((i) => `[${i.area}] ${i.message}`).slice(0, 25);
  if (env === "math") {
    const g = gradeMath(readMath(value), null);
    return g.problems.map((p) => `${p.part} : ${p.problem.message}`);
  }
  const w = readAlgo(value);
  return lintAlgo(w.code, w.language).filter((i) => i.level !== "info").map((i) => `ligne ${i.line} : ${i.message}`).slice(0, 25);
}

export { readAlgo, readMath, readMerise };
