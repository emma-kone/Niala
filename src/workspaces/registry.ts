import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Registre des environnements de travail et moteur de sélection.
// L'application décide de l'espace de travail à partir de listes contrôlées : l'IA peut proposer une configuration
// (voir environmentProposalSchema), mais seule une valeur de ce registre est acceptée. Ajouter une discipline = ajouter
// une entrée ici, son composant et sa correction, sans toucher au moteur d'exercices.
// ─────────────────────────────────────────────────────────────────────────────

export const WORKSPACE_ENVIRONMENTS = ["text", "merise", "math", "algo", "code", "sql"] as const;
export type WorkspaceEnvironment = (typeof WORKSPACE_ENVIRONMENTS)[number];

export interface EnvironmentInfo {
  id: WorkspaceEnvironment;
  label: string;
  description: string;
  /** Outils proposés dans l'espace de travail. */
  tools: string[];
  /** Production attendue (livrables par défaut). */
  deliverables: string[];
  /** Environnement disponible dans cette version : sinon l'exercice reste textuel et la limite est signalée. */
  available: boolean;
}

export const ENVIRONMENTS: Record<WorkspaceEnvironment, EnvironmentInfo> = {
  text: { id: "text", label: "Rédaction", description: "Réponse rédigée.", tools: ["Zone de texte"], deliverables: ["Réponse rédigée"], available: true },
  merise: { id: "merise", label: "Atelier Merise", description: "Dictionnaire de données, dépendances fonctionnelles, MCD, MLD, MPD, MCT et flux.", tools: ["Dictionnaire", "Dépendances", "MCD", "MLD", "MPD", "MCT", "Flux"], deliverables: ["Modèles demandés par la consigne"], available: true },
  math: { id: "math", label: "Espace mathématique", description: "Éditeur de formules, étapes de résolution, graphiques.", tools: ["Éditeur de formules", "Étapes de résolution", "Graphique"], deliverables: ["Étapes de résolution", "Résultat final"], available: true },
  algo: { id: "algo", label: "Éditeur algorithmique", description: "Algorithme en pseudo-code ou programme, avec vérification et exécution quand le langage s'y prête.", tools: ["Éditeur", "Vérification de structure", "Exécution isolée"], deliverables: ["Algorithme ou programme"], available: true },
  code: { id: "code", label: "Éditeur de code", description: "Programme exécuté dans un environnement isolé.", tools: ["Éditeur", "Terminal", "Tests"], deliverables: ["Programme"], available: true },
  sql: { id: "sql", label: "Éditeur SQL", description: "Requêtes SQL et visualisation des résultats.", tools: ["Éditeur SQL", "Résultats"], deliverables: ["Requêtes SQL"], available: true },
};

/** Disciplines que le registre ne couvre pas encore : l'exercice reste textuel, la limite est indiquée à l'étudiant. */
export const UNSUPPORTED_DISCIPLINES: { id: string; label: string; pattern: RegExp }[] = [
  { id: "electronique", label: "Électronique", pattern: /\b(circuit|résistance|resistance|transistor|diode|condensateur|loi d'ohm|schéma électrique|schema electrique)\b/i },
  { id: "reseaux", label: "Réseaux", pattern: /\b(adressage ip|sous-?réseau|sous-?reseau|vlsm|routage|topologie réseau|topologie reseau|masque de sous)\b/i },
  { id: "comptabilite", label: "Comptabilité", pattern: /\b(bilan comptable|compte de résultat|compte de resultat|journal comptable|amortissement|écriture comptable|ecriture comptable)\b/i },
  { id: "physique", label: "Physique", pattern: /\b(vitesse|accélération|acceleration|énergie cinétique|energie cinetique|force gravitationnelle|newton)\b/i },
];

export interface Inference {
  environment: WorkspaceEnvironment;
  /** 0 à 1 : en dessous de 0,6, l'IA peut proposer une configuration (validée ensuite). */
  confidence: number;
  reasons: string[];
  /** Discipline reconnue mais pas encore outillée. */
  unsupported?: string;
}

const RULES: { env: WorkspaceEnvironment; weight: number; test: RegExp; why: string }[] = [
  { env: "merise", weight: 0.9, test: /\b(merise|mcd|mld|mpd|mct|mcc|dictionnaire de donn[ée]es|d[ée]pendances? fonctionnelles?|mod[èe]le conceptuel|mod[èe]le logique|mod[èe]le physique|cardinalit[ée]s?)\b/i, why: "vocabulaire Merise" },
  { env: "merise", weight: 0.45, test: /\b(entit[ée]s?|associations?)\b.*\b(identifiant|cardinalit|propri[ée]t[ée]s?)\b|\b(identifiant|cardinalit|propri[ée]t[ée]s?)\b.*\b(entit[ée]s?|associations?)\b/i, why: "entités, associations et identifiants" },
  { env: "sql", weight: 0.9, test: /\b(requ[êe]tes? sql|select\b|insert into|create table|jointures?|group by|sous-requ[êe]tes?)/i, why: "requêtes SQL" },
  { env: "algo", weight: 0.85, test: /\b(algorithme|pseudo-?code|organigramme|[ée]crire un algorithme|algorithmique)\b/i, why: "algorithme ou pseudo-code" },
  { env: "code", weight: 0.8, test: /\b(programme|fonction|script|classe)\b.*\b(python|java|javascript|typescript|c\+\+|c#|php)\b|\b(en|avec) (python|java|javascript|typescript|c\+\+|php)\b/i, why: "programmation dans un langage" },
  { env: "math", weight: 0.8, test: /\b([ée]quations?|syst[èe]mes? d'[ée]quations?|d[ée]riv[ée]e|int[ée]grale|primitive|limites?|polyn[ôo]mes?|matrices?|d[ée]terminant|suites? (num[ée]riques?|arithm[ée]tiques?|g[ée]om[ée]triques?)|[ée]tudier la fonction|r[ée]soudre|d[ée]montrer que|calculer)\b|\$[^$]+\$|\\frac|\\int|\\sum/i, why: "calcul ou résolution mathématique" },
];

/** Moteur de sélection déterministe : associe la nature d'un exercice à l'environnement le plus adapté. */
export function inferEnvironment(input: { subject?: string | null; chapter?: string | null; statement: string; type?: string }): Inference {
  const text = `${input.subject ?? ""} ${input.chapter ?? ""} ${input.statement}`;
  const score = new Map<WorkspaceEnvironment, { value: number; reasons: string[] }>();
  for (const r of RULES) {
    if (!r.test.test(text)) continue;
    const s = score.get(r.env) ?? { value: 0, reasons: [] };
    s.value = Math.min(1, s.value + r.weight * (s.value ? 0.5 : 1));
    s.reasons.push(r.why);
    score.set(r.env, s);
  }
  // La matière indiquée par l'étudiant ou le cours oriente le choix, sans l'imposer.
  const subject = `${input.subject ?? ""} ${input.chapter ?? ""}`;
  if (/merise|conception (de )?base|syst[èe]mes? d'information|mod[ée]lisation/i.test(subject)) bump(score, "merise", 0.25, "matière de modélisation");
  if (/math|analyse|alg[èe]bre|probabilit|statistique/i.test(subject)) bump(score, "math", 0.25, "matière mathématique");
  if (/algorithm/i.test(subject)) bump(score, "algo", 0.25, "matière d'algorithmique");
  if (/base de donn[ée]es|sql/i.test(subject)) bump(score, "sql", 0.15, "matière de bases de données");
  if (/programmation|d[ée]veloppement/i.test(subject)) bump(score, "code", 0.15, "matière de programmation");

  const ranked = [...score.entries()].sort((a, b) => b[1].value - a[1].value);
  if (ranked.length === 0) {
    const unsupported = UNSUPPORTED_DISCIPLINES.find((d) => d.pattern.test(text));
    return { environment: "text", confidence: unsupported ? 0.7 : 0.4, reasons: [unsupported ? `discipline « ${unsupported.label} » sans atelier dédié` : "aucun indice d'atelier spécialisé"], ...(unsupported ? { unsupported: unsupported.label } : {}) };
  }
  let [env, best] = ranked[0];
  // Merise l'emporte sur SQL/maths quand le vocabulaire de modélisation est présent (« donner le MLD… »).
  if (score.has("merise") && score.get("merise")!.value >= 0.9) [env, best] = ["merise", score.get("merise")!];
  const second = ranked.find(([e]) => e !== env)?.[1].value ?? 0;
  return { environment: env, confidence: Math.max(0.2, Math.min(1, best.value - second * 0.3)), reasons: best.reasons };
}

function bump(score: Map<WorkspaceEnvironment, { value: number; reasons: string[] }>, env: WorkspaceEnvironment, by: number, why: string) {
  const s = score.get(env) ?? { value: 0, reasons: [] };
  s.value = Math.min(1, s.value + by);
  s.reasons.push(why);
  score.set(env, s);
}

/** Configuration proposée par l'IA : contrôlée par le registre avant toute utilisation. */
export const environmentProposalSchema = z.object({
  environment: z.enum(WORKSPACE_ENVIRONMENTS),
  deliverables: z.array(z.string().trim().min(2).max(120)).max(8).catch([]),
  tools: z.array(z.string().trim().min(2).max(60)).max(8).catch([]),
});

/** Fusionne une proposition de l'IA avec le registre : environnement inconnu ou indisponible → texte ; outils limités à ceux du registre. */
export function validateProposal(raw: unknown, fallback: Inference): { environment: WorkspaceEnvironment; deliverables: string[]; tools: string[]; source: "ai" | "rules" } {
  const p = environmentProposalSchema.safeParse(raw);
  if (!p.success || !ENVIRONMENTS[p.data.environment].available) return { environment: fallback.environment, deliverables: ENVIRONMENTS[fallback.environment].deliverables, tools: ENVIRONMENTS[fallback.environment].tools, source: "rules" };
  const info = ENVIRONMENTS[p.data.environment];
  const known = new Set(info.tools.map((t) => t.toLowerCase()));
  const tools = p.data.tools.filter((t) => known.has(t.toLowerCase()));
  return { environment: p.data.environment, deliverables: p.data.deliverables.length ? p.data.deliverables : info.deliverables, tools: tools.length ? tools : info.tools, source: "ai" };
}

export const isEnvironment = (v: unknown): v is WorkspaceEnvironment => typeof v === "string" && (WORKSPACE_ENVIRONMENTS as readonly string[]).includes(v);
