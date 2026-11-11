import { dbAll as db } from "@/lib/db";
import { cached, n } from "@/server/admin/stats/common";
import { MODULES } from "@/server/analytics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Anomalies de la plateforme : routes lentes, erreurs récurrentes, échecs d'IA, imports en erreur, alertes ouvertes et
// signalements des étudiants. Chaque anomalie est classée par priorité (comme une liste de tâches) et accompagnée d'un
// PROMPT prêt à être transmis à un assistant de développement pour qu'il la corrige.
// Tout vient des mesures réelles (RequestLog, AIUsageLog, Document, SupportRequest, AdminAlert) : aucune donnée inventée,
// et aucun contenu d'étudiant (seulement des routes, des compteurs et des durées).
// ─────────────────────────────────────────────────────────────────────────────

export type Priority = "P1" | "P2" | "P3" | "P4";
export type AnomalyCategory = "performance" | "erreurs" | "ia" | "imports" | "alertes" | "retours";

export const PRIORITY_LABELS: Record<Priority, string> = {
  P1: "Critique : à traiter en premier",
  P2: "Élevée",
  P3: "Moyenne",
  P4: "Faible",
};

export const CATEGORY_LABELS: Record<AnomalyCategory, string> = {
  performance: "Performance",
  erreurs: "Erreurs",
  ia: "Intelligence artificielle",
  imports: "Imports de documents",
  alertes: "Alertes",
  retours: "Retours des étudiants",
};

export interface Anomaly {
  /** Stable d'une analyse à l'autre : sert à marquer l'anomalie comme traitée. */
  id: string;
  priority: Priority;
  /** 0-100, sert au classement. */
  score: number;
  category: AnomalyCategory;
  title: string;
  summary: string;
  evidence: string[];
  files: string[];
  prompt: string;
}

export interface AnomalyReport {
  generatedAt: Date;
  days: number;
  anomalies: Anomaly[];
  /** Prompt unique reprenant toutes les anomalies dans l'ordre de priorité. */
  masterPrompt: string;
  notes: string[];
}

export const DEFAULT_DAYS = 7;

// Opérations légitimement longues (génération par IA, import, exécution de code) : seuil de lenteur propre à chacune.
const LONG_RUNNING: { match: RegExp; slowMs: number; label: string }[] = [
  { match: /^\/api\/(agenda\/imports|exercises|maps)(\/|$)/, slowMs: 20_000, label: "opération longue (IA / import)" },
  { match: /^\/api\/(uploads|files|labs|conversations|assistant|documents)/, slowMs: 8_000, label: "opération lourde (fichier / IA / exécution)" },
];
const DEFAULT_SLOW_MS = 2_000;

const slowThreshold = (route: string) => LONG_RUNNING.find((r) => r.match.test(route))?.slowMs ?? DEFAULT_SLOW_MS;
const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const priorityOf = (score: number): Priority => (score >= 75 ? "P1" : score >= 55 ? "P2" : score >= 35 ? "P3" : "P4");
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(v)} ms`);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** « /api/files/:id/analysis » → « src/app/api/files/[id]/analysis/route.ts » (à vérifier : le nom du paramètre peut différer). */
export function routeFile(route: string): string {
  return `src/app${route.split("/").map((s) => (s === ":id" ? "[id]" : s)).join("/")}/route.ts`;
}

const DIRECTIVES = [
  "Contraintes : préserver toutes les fonctionnalités existantes (aucune suppression, aucun bouton ou comportement dégradé) ; respecter l'architecture et les conventions du projet ; lire le guide concerné dans node_modules/next/dist/docs/ avant d'écrire du code Next.js (cette version diffère de ce que tu connais).",
  "Vérification : lancer le contrôle de types, le lint et les tests ; exécuter ou simuler le scénario en cause ; ne déclarer la tâche terminée qu'une fois la mesure revenue sous le seuil visé.",
  "Compte rendu attendu : cause racine identifiée, correctif appliqué (fichiers modifiés), tests ajoutés, vérifications effectuées et résultats réels, limites restantes.",
];

function buildPrompt(a: Omit<Anomaly, "prompt" | "id" | "priority" | "score">, priority: Priority, goal: string, steps: string[], days: number): string {
  return [
    `# ${priority} · ${a.title}`,
    "",
    "## Contexte",
    `Plateforme Niala (Next.js App Router, Prisma, PostgreSQL). Anomalie détectée automatiquement par le back-office sur les ${days} derniers jours. Catégorie : ${CATEGORY_LABELS[a.category]}.`,
    "",
    "## Constat mesuré",
    ...a.evidence.map((e) => `- ${e}`),
    "",
    ...(a.files.length ? ["## Fichiers probables (à vérifier)", ...a.files.map((f) => `- ${f}`), ""] : []),
    "## À faire",
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Objectif mesurable",
    goal,
    "",
    "## Règles de travail",
    ...DIRECTIVES.map((d) => `- ${d}`),
  ].join("\n");
}

function make(input: { key: string; score: number; category: AnomalyCategory; title: string; summary: string; evidence: string[]; files?: string[]; goal: string; steps: string[] }, days: number): Anomaly {
  const score = Math.round(clamp(input.score));
  const priority = priorityOf(score);
  const base = { category: input.category, title: input.title, summary: input.summary, evidence: input.evidence, files: input.files ?? [] };
  return { id: input.key, priority, score, ...base, prompt: buildPrompt(base, priority, input.goal, input.steps, days) };
}

export async function getAnomalies(days = DEFAULT_DAYS): Promise<AnomalyReport> {
  return cached(`anomalies:${days}`, () => compute(days));
}

async function compute(days: number): Promise<AnomalyReport> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [slow, errors, aiFail, aiSlow, docs, alerts, reports, pageLoad, volume] = await Promise.all([
    db.$queryRaw<{ route: string; method: string; c: bigint; avg: number; p95: number; max: number }[]>`
      SELECT route, method, count(*) AS c, avg("durationMs") AS avg, percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95, max("durationMs") AS max
      FROM "RequestLog" WHERE "createdAt" >= ${since} GROUP BY route, method HAVING count(*) >= 3 ORDER BY p95 DESC LIMIT 60`,
    db.$queryRaw<{ route: string; method: string; status: number; kind: string | null; summary: string | null; c: bigint; last: Date }[]>`
      SELECT route, method, status, "errorKind" AS kind, max("errorSummary") AS summary, count(*) AS c, max("createdAt") AS last
      FROM "RequestLog" WHERE status >= 400 AND "createdAt" >= ${since} GROUP BY 1, 2, 3, 4 HAVING count(*) >= 2 ORDER BY c DESC LIMIT 40`,
    db.$queryRaw<{ op: string; model: string | null; c: bigint; f: bigint; err: string | null }[]>`
      SELECT op, model, count(*) AS c, count(*) FILTER (WHERE ok = false) AS f, max(error) FILTER (WHERE ok = false) AS err
      FROM "AIUsageLog" WHERE "createdAt" >= ${since} GROUP BY 1, 2 HAVING count(*) FILTER (WHERE ok = false) >= 2 ORDER BY f DESC LIMIT 15`,
    db.$queryRaw<{ op: string; c: bigint; avg: number; p95: number }[]>`
      SELECT op, count(*) AS c, avg("durationMs") AS avg, percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs") AS p95
      FROM "AIUsageLog" WHERE ok AND "durationMs" IS NOT NULL AND "createdAt" >= ${since} GROUP BY 1 HAVING count(*) >= 3 AND avg("durationMs") > 25000 ORDER BY avg DESC LIMIT 10`,
    db.document.count({ where: { status: "ERROR", updatedAt: { gte: since } } }),
    db.adminAlert.findMany({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, key: true, severity: true, title: true, detail: true } }),
    db.$queryRaw<{ type: string; module: string | null; c: bigint; users: bigint }[]>`
      SELECT type, module, count(*) AS c, count(DISTINCT "userId") AS users
      FROM "SupportRequest" WHERE "deletedAt" IS NULL AND type IN ('BUG', 'AI_ISSUE', 'EXERCISE_DIFFICULTY') AND status NOT IN ('RESOLVED', 'REJECTED') AND "createdAt" >= ${since}
      GROUP BY 1, 2 HAVING count(*) >= 2 ORDER BY c DESC LIMIT 10`,
    db.$queryRaw<{ module: string | null; c: bigint; p75: number }[]>`
      SELECT module, count(*) AS c, percentile_cont(0.75) WITHIN GROUP (ORDER BY "durationMs") AS p75
      FROM "AnalyticsEvent" WHERE type = 'page.load' AND "durationMs" IS NOT NULL AND "createdAt" >= ${since} GROUP BY 1 HAVING count(*) >= 5 AND percentile_cont(0.75) WITHIN GROUP (ORDER BY "durationMs") > 4000 ORDER BY p75 DESC LIMIT 8`,
    db.$queryRaw<{ route: string; method: string; c: bigint }[]>`
      SELECT route, method, count(*) AS c FROM "RequestLog" WHERE "createdAt" >= ${since} AND method = 'GET' AND route LIKE '/api/%' GROUP BY 1, 2 ORDER BY c DESC LIMIT 40`,
  ]);

  const callsOf = new Map(volume.map((v) => [`${v.method} ${v.route}`, n(v.c)]));
  const list: Anomaly[] = [];

  // ── Routes lentes ──
  for (const r of slow) {
    const threshold = slowThreshold(r.route);
    const p95 = Math.round(Number(r.p95));
    if (p95 < threshold) continue;
    const count = n(r.c);
    const avg = Math.round(Number(r.avg));
    const ratio = p95 / threshold;
    // Plus une route est lente, fréquente et plus elle dépasse son seuil, plus elle est prioritaire.
    const score = 30 + Math.min(30, (ratio - 1) * 12) + Math.min(25, Math.log10(count + 1) * 11) + (r.method === "GET" ? 8 : 0);
    const long = LONG_RUNNING.find((x) => x.match.test(r.route));
    list.push(
      make(
        {
          key: `slow:${r.method}:${slug(r.route)}`,
          score,
          category: "performance",
          title: `Route lente : ${r.method} ${r.route}`,
          summary: `95 % des appels prennent moins de ${ms(p95)} (seuil attendu : ${ms(threshold)}).`,
          evidence: [`${count} appels sur ${days} jours · moyenne ${ms(avg)} · p95 ${ms(p95)} · maximum ${ms(Number(r.max))}`, `Seuil de référence : ${ms(threshold)}${long ? ` (${long.label})` : ""}`, ...(r.method === "GET" && count >= 50 ? [`Route très sollicitée (${count} lectures) : un gain, même petit, profite à chaque étudiant.`] : [])],
          files: [routeFile(r.route)],
          goal: `p95 de ${r.method} ${r.route} sous ${ms(threshold)} (aujourd'hui ${ms(p95)}), sans changer le contenu de la réponse.`,
          steps: [
            "Lire la route et les services qu'elle appelle ; lister chaque requête base de données et chaque appel externe dans l'ordre où ils s'exécutent.",
            "Repérer les requêtes séquentielles indépendantes (à passer en Promise.all), les requêtes en boucle (N+1), les lectures inutiles ou trop larges (colonnes non utilisées, absence de select/take) et les index manquants.",
            "Éviter de relire deux fois la même donnée dans une même requête (authentification, profil, réglages) et envisager un cache court ou une revalidation en arrière-plan quand la donnée change peu.",
            ...(long ? ["Pour une opération longue : la sortir du chemin de la requête (traitement asynchrone avec suivi d'état) ou afficher une progression côté interface plutôt que laisser l'étudiant attendre sans retour."] : []),
            "Mesurer avant/après (temps de réponse sur le même jeu de données) et consigner les chiffres.",
          ],
        },
        days
      )
    );
  }

  // ── Erreurs récurrentes ──
  for (const e of errors) {
    const count = n(e.c);
    const serverSide = e.status >= 500;
    // 401/404/409/429 sont le plus souvent des fautes de saisie ou des tentatives : on ne les remonte que si elles sont massives.
    if (!serverSide && (count < 15 || [401, 404, 429].includes(e.status))) continue;
    const score = (serverSide ? 55 : 22) + Math.min(30, Math.log10(count + 1) * 16) + (e.kind === "APP" ? 6 : 0) + (callsOf.get(`${e.method} ${e.route}`) ? 4 : 0);
    list.push(
      make(
        {
          key: `error:${e.method}:${slug(e.route)}:${e.status}`,
          score,
          category: "erreurs",
          title: `${serverSide ? "Erreur serveur" : "Erreur"} ${e.status} récurrente : ${e.method} ${e.route}`,
          summary: `${count} réponses en erreur ${e.status} sur ${days} jours.`,
          evidence: [`${count} occurrences · dernière le ${e.last.toISOString().slice(0, 16).replace("T", " ")} UTC`, ...(e.kind ? [`Classe d'erreur : ${e.kind === "APP" ? "défaut de l'application" : e.kind === "EXTERNAL" ? "service externe" : "action de l'utilisateur"}`] : []), ...(e.summary ? [`Résumé technique : ${e.summary}`] : [])],
          files: [routeFile(e.route)],
          goal: serverSide ? `Plus aucune erreur ${e.status} sur ${e.method} ${e.route} dans les cas normaux d'utilisation ; les cas limites renvoient une erreur explicite (4xx) avec un message utile.` : `Comprendre pourquoi ${e.method} ${e.route} répond ${e.status} aussi souvent et l'éviter à la source (validation côté interface, message clair, comportement attendu).`,
          steps: [
            "Reproduire l'erreur à partir de la route et du résumé technique ci-dessus ; si le résumé est insuffisant, ajouter une journalisation ciblée (sans donnée personnelle).",
            "Identifier la cause racine (donnée absente ou invalide, migration non appliquée, exception non rattrapée, dépendance externe indisponible, concurrence).",
            "Corriger la cause, pas seulement le symptôme ; transformer toute exception non gérée en réponse HTTP appropriée avec un message compréhensible côté interface.",
            "Ajouter un test automatisé qui échouait avant le correctif.",
          ],
        },
        days
      )
    );
  }

  // ── Échecs d'IA ──
  for (const f of aiFail) {
    const failed = n(f.f);
    const total = n(f.c);
    const rate = total ? Math.round((failed / total) * 100) : 0;
    list.push(
      make(
        {
          key: `ai-fail:${slug(f.op)}:${slug(f.model ?? "inconnu")}`,
          score: 40 + Math.min(30, rate * 0.6) + Math.min(15, Math.log10(failed + 1) * 9),
          category: "ia",
          title: `Échecs d'appels IA : opération « ${f.op} »`,
          summary: `${failed} appels en échec sur ${total} (${rate} %).`,
          evidence: [`Modèle : ${f.model ?? "non renseigné"}`, `${failed} échecs / ${total} appels sur ${days} jours`, ...(f.err ? [`Dernier message d'erreur : ${f.err.slice(0, 160)}`] : [])],
          files: ["src/server/ai/", "src/server/services/"],
          goal: `Taux d'échec de l'opération « ${f.op} » sous 2 %, avec une reprise automatique propre et un message clair pour l'étudiant quand l'IA est indisponible.`,
          steps: [
            "Rechercher dans src/server/ai l'endroit où l'opération est appelée et comment l'erreur est enregistrée.",
            "Classer les échecs : quota, délai dépassé, réponse non conforme au schéma, indisponibilité du fournisseur.",
            "Ajouter ce qui manque : validation et réparation de la réponse, nouvel essai avec délai croissant, repli sur un autre modèle, message d'erreur actionnable.",
            "Vérifier que l'étudiant ne perd jamais son travail quand l'IA échoue.",
          ],
        },
        days
      )
    );
  }
  for (const s of aiSlow) {
    const avg = Math.round(Number(s.avg));
    list.push(
      make(
        {
          key: `ai-slow:${slug(s.op)}`,
          score: 33 + Math.min(20, (avg / 25_000) * 6),
          category: "ia",
          title: `Appels IA lents : opération « ${s.op} »`,
          summary: `Durée moyenne ${ms(avg)} sur ${n(s.c)} appels.`,
          evidence: [`Moyenne ${ms(avg)} · p95 ${ms(Number(s.p95))} · ${n(s.c)} appels réussis sur ${days} jours`],
          files: ["src/server/ai/", "src/server/services/"],
          goal: `Réduire la durée perçue de « ${s.op} » (diffusion progressive, découpage, modèle plus rapide pour les étapes simples) sans baisse de qualité.`,
          steps: ["Mesurer la part du temps passée dans le fournisseur d'IA et celle passée dans l'application.", "Réduire la taille des entrées (contexte inutile), découper les tâches indépendantes en parallèle, diffuser la réponse au fur et à mesure.", "Afficher une progression claire à l'étudiant pendant l'attente."],
        },
        days
      )
    );
  }

  // ── Imports en erreur ──
  const failedDocs = docs;
  if (failedDocs >= 2) {
    list.push(
      make(
        {
          key: "imports:documents-error",
          score: 45 + Math.min(25, Math.log10(failedDocs + 1) * 15),
          category: "imports",
          title: "Documents importés qui échouent à l'analyse",
          summary: `${failedDocs} documents en erreur sur ${days} jours.`,
          evidence: [`${failedDocs} documents au statut « erreur » sur ${days} jours`],
          files: ["src/server/services/", "src/app/api/uploads/", "src/app/api/files/"],
          goal: "Les formats courants (PDF, Word, images, textes) s'importent sans erreur ; tout échec affiche une raison claire et propose de réessayer.",
          steps: ["Retrouver la chaîne d'import (préparation, envoi, finalisation, extraction, analyse) et les points où le statut passe à « erreur ».", "Journaliser la cause exacte de chaque échec (format, taille, extraction vide, délai dépassé) sans conserver le contenu.", "Corriger les causes les plus fréquentes et proposer un nouvel essai en un clic."],
        },
        days
      )
    );
  }

  // ── Chargement des pages côté navigateur ──
  for (const p of pageLoad) {
    const p75 = Math.round(Number(p.p75));
    const label = p.module ? (MODULES[p.module as keyof typeof MODULES] ?? p.module) : "pages sans module";
    list.push(
      make(
        {
          key: `page-load:${slug(p.module ?? "autres")}`,
          score: 32 + Math.min(25, (p75 / 4000 - 1) * 12),
          category: "performance",
          title: `Chargement lent côté étudiant : ${label}`,
          summary: `75 % des chargements prennent moins de ${ms(p75)}.`,
          evidence: [`${n(p.c)} chargements mesurés dans le navigateur · p75 ${ms(p75)} (seuil : 4 s)`],
          files: p.module ? [`src/app/(app)/${p.module}/`, `src/features/${p.module}/`] : ["src/app/(app)/"],
          goal: `p75 du chargement du module « ${label} » sous 2,5 s.`,
          steps: ["Mesurer : poids du JavaScript chargé, requêtes déclenchées au montage, rendu serveur contre rendu client.", "Charger à la demande les composants lourds (import dynamique), précharger les données de la page depuis le serveur, éviter les cascades de requêtes.", "Afficher le squelette de la page aussitôt et conserver les données déjà vues pendant l'actualisation en arrière-plan."],
        },
        days
      )
    );
  }

  // ── Alertes ouvertes ──
  for (const a of alerts) {
    list.push(
      make(
        {
          key: `alert:${a.key}`,
          score: a.severity === "CRITICAL" ? 92 : 62,
          category: "alertes",
          title: `Alerte ouverte : ${a.title}`,
          summary: a.detail ?? "Alerte déclenchée par la supervision.",
          evidence: [`Gravité : ${a.severity === "CRITICAL" ? "critique" : "avertissement"}`, ...(a.detail ? [a.detail] : [])],
          files: ["src/server/admin/stats/tech.ts"],
          goal: "L'alerte se résout d'elle-même parce que la cause est corrigée (pas en la masquant).",
          steps: ["Comprendre la règle qui a déclenché l'alerte (src/server/admin/stats/tech.ts) et la période concernée.", "Trouver la route, l'opération ou le service responsable à partir des mesures de la période.", "Corriger la cause ; ne pas relever le seuil pour faire taire l'alerte."],
        },
        days
      )
    );
  }

  // ── Retours des étudiants (problèmes signalés plusieurs fois) ──
  for (const r of reports) {
    const count = n(r.c);
    const mod = r.module ? (MODULES[r.module as keyof typeof MODULES] ?? r.module) : "module non précisé";
    const kind = r.type === "BUG" ? "problèmes techniques" : r.type === "AI_ISSUE" ? "problèmes liés à l'IA" : "difficultés d'exercice";
    list.push(
      make(
        {
          key: `reports:${r.type}:${slug(r.module ?? "none")}`,
          score: 38 + Math.min(30, count * 5) + Math.min(10, n(r.users) * 2),
          category: "retours",
          title: `${count} ${kind} signalés : ${mod}`,
          summary: `${n(r.users)} étudiant(s) concerné(s), demandes encore ouvertes.`,
          evidence: [`${count} demandes ouvertes (${kind}) sur ${days} jours, module : ${mod}`, `${n(r.users)} étudiant(s) distinct(s)`, "Détail et messages : rubrique « Suggestions et demandes » du back-office."],
          files: r.module ? [`src/features/${r.module}/`, `src/app/(app)/${r.module}/`] : [],
          goal: "Chaque problème signalé est reproduit, corrigé ou expliqué, et les demandes concernées sont mises à jour.",
          steps: ["Lire les demandes ouvertes de ce type dans le back-office et regrouper celles qui décrivent le même défaut.", "Reproduire chaque défaut dans le module concerné et corriger la cause.", "Répondre aux étudiants et passer les demandes à « Résolue » une fois le correctif déployé."],
        },
        days
      )
    );
  }

  list.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "fr"));
  const anomalies = list.slice(0, 40);

  const notes = [
    "Les mesures viennent du trafic réel de l'application (temps de réponse et statuts des requêtes d'API, appels IA, imports). Une route peu utilisée peut rester invisible tant qu'elle n'a pas été appelée au moins 3 fois.",
    "Le temps mesuré inclut l'attente de la base de données : en développement, une base distante ajoute plusieurs centaines de millisecondes à chaque requête.",
  ];
  return { generatedAt: new Date(), days, anomalies, masterPrompt: buildMasterPrompt(anomalies, days), notes };
}

export function buildMasterPrompt(anomalies: Anomaly[], days: number): string {
  if (!anomalies.length) return "Aucune anomalie à traiter.";
  return [
    "# Plan de correction des anomalies de Niala",
    "",
    `Anomalies détectées par le back-office sur les ${days} derniers jours, classées de la plus prioritaire à la moins prioritaire. Traite-les dans cet ordre, une à la fois ; après chacune, vérifie qu'aucune fonctionnalité existante n'est dégradée, puis passe à la suivante.`,
    "",
    ...anomalies.map((a, i) => `${i + 1}. [${a.priority}] ${a.title} : ${a.summary}`),
    "",
    "---",
    "",
    ...anomalies.flatMap((a, i) => [`## Tâche ${i + 1} / ${anomalies.length}`, "", a.prompt, "", "---", ""]),
  ].join("\n");
}
