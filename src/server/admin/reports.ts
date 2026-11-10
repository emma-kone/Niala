import type { Period } from "@/server/admin/stats/common";
import { getOverview } from "@/server/admin/stats/overview";
import { getCategoryComparison, getHeatmap, getRetention, WEEKDAYS } from "@/server/admin/stats/usage";
import { getFeatureReport } from "@/server/admin/stats/features";
import { getPedagogy } from "@/server/admin/stats/pedagogy";
import { getTechReport } from "@/server/admin/stats/tech";
import { getAiReport } from "@/server/admin/stats/ai";
import { getRequestAnalytics } from "@/server/admin/support";
import { coverage } from "@/server/admin/stats/common";

// Rapports exportables. Chaque rapport reprend la période choisie et se compose de tableaux (et de séries pour les graphiques).
// Les mêmes fonctions que les écrans alimentent les rapports : un export ne peut pas différer de ce que voit l'administrateur.

export type Cell = string | number | null;
export interface ReportTable { title: string; columns: string[]; rows: Cell[][] }
export interface ReportChart { title: string; kind: "line" | "bar"; labels: string[]; values: number[] }
export interface Report { key: string; title: string; period: Period; generatedAt: Date; notes: string[]; tables: ReportTable[]; charts: ReportChart[] }

export const REPORTS = [
  { key: "users", label: "Évolution des utilisateurs" },
  { key: "activity", label: "Activité de la plateforme" },
  { key: "features", label: "Utilisation des fonctionnalités" },
  { key: "hours", label: "Tendances horaires" },
  { key: "pedagogy", label: "Progression pédagogique globale" },
  { key: "requests", label: "Suggestions reçues" },
  { key: "tech", label: "Performances techniques" },
  { key: "ai", label: "Utilisation de l'IA" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];
export const REPORT_PERMISSION_NOTE = "Les nombres affichés « événements » ne couvrent que la période de collecte en direct ; les nombres « tables » couvrent tout l'historique.";

const day = (d: Date) => d.toISOString().slice(0, 10);
const label = (p: Period) => (p.bucket === "hour" ? (d: Date) => `${day(d)} ${String(d.getUTCHours()).padStart(2, "0")} h` : (d: Date) => day(d));
const pct = (v: number | null) => (v == null ? null : `${v} %`);
const chg = (v: number | null) => (v == null ? "n/d" : `${v > 0 ? "+" : ""}${v} %`);

export async function buildReport(key: string, period: Period, opts: { module?: string | null } = {}): Promise<Report> {
  const cov = await coverage();
  const base = { period, generatedAt: new Date(), notes: [REPORT_PERMISSION_NOTE, cov.liveSince ? `Collecte des événements en direct depuis le ${day(cov.liveSince)}.` : "Aucun événement en direct n'a encore été collecté."], charts: [] as ReportChart[] };
  switch (key) {
    case "users": {
      const [o, r] = await Promise.all([getOverview(period), getRetention()]);
      const kpiRows = [...o.kpis.users].map((k): Cell[] => [k.label, k.value, k.previous, chg(k.change), k.source === "table" ? "Historique complet" : "Événements collectés"]);
      return {
        ...base, key, title: "Évolution des utilisateurs",
        tables: [
          { title: "Indicateurs", columns: ["Indicateur", "Valeur", "Période précédente", "Évolution", "Source"], rows: kpiRows },
          { title: "Inscriptions et utilisateurs actifs", columns: ["Période", "Inscriptions", "Utilisateurs actifs"], rows: o.series.registrations.map((s, i): Cell[] => [label(period)(s.bucket), s.value, o.series.activeUsers[i]?.value ?? 0]) },
          { title: "Répartition par catégorie", columns: ["Catégorie", "Comptes"], rows: o.categories.map((c): Cell[] => [c.label, c.value]) },
          { title: "Rétention par cohorte d'inscription (hebdomadaire)", columns: ["Semaine", "Inscrits", "J1", "J7", "J30"], rows: r.cohorts.map((c): Cell[] => [day(c.cohort), c.size, pct(c.d1) ?? "n/d", pct(c.d7) ?? "n/d", pct(c.d30) ?? "n/d"]) },
        ],
        charts: [{ title: "Inscriptions", kind: "bar", labels: o.series.registrations.map((s) => label(period)(s.bucket)), values: o.series.registrations.map((s) => s.value) }, { title: "Utilisateurs actifs", kind: "line", labels: o.series.activeUsers.map((s) => label(period)(s.bucket)), values: o.series.activeUsers.map((s) => s.value) }],
      };
    }
    case "activity": {
      const [o, cats] = await Promise.all([getOverview(period), getCategoryComparison(period)]);
      return {
        ...base, key, title: "Activité de la plateforme",
        tables: [
          { title: "Utilisation", columns: ["Indicateur", "Valeur", "Période précédente", "Évolution"], rows: [...o.kpis.usage, ...o.kpis.engagement].map((k): Cell[] => [k.label, k.value, k.previous, chg(k.change)]) },
          { title: "Sessions par période", columns: ["Période", "Sessions", "Exercices réalisés", "Actions par utilisateur actif"], rows: o.series.sessions.map((s, i): Cell[] => [label(period)(s.bucket), s.value, o.series.exercises[i]?.value ?? 0, o.series.engagement[i]?.value ?? 0]) },
          { title: "Comparaison des catégories", columns: ["Catégorie", "Comptes", "Actifs", "Sessions", "Sessions / actif", "Durée moyenne (min)", "Exercices terminés"], rows: cats.map((c): Cell[] => [c.label, c.accounts, c.active, c.sessions, c.sessionsPerUser, c.avgSessionMin, c.exercisesDone]) },
        ],
        charts: [{ title: "Sessions", kind: "line", labels: o.series.sessions.map((s) => label(period)(s.bucket)), values: o.series.sessions.map((s) => s.value) }, { title: "Exercices réalisés", kind: "bar", labels: o.series.exercises.map((s) => label(period)(s.bucket)), values: o.series.exercises.map((s) => s.value) }],
      };
    }
    case "features": {
      const f = await getFeatureReport(period);
      return {
        ...base, key, title: "Utilisation des fonctionnalités",
        tables: [
          { title: "Fonctionnalités", columns: ["Fonctionnalité", "Utilisateurs uniques", "Utilisations", "Évolution", "Fréquence", "Adoption", "Taux d'abandon", "Erreurs", "Temps moyen (ms)"], rows: f.features.map((x): Cell[] => [x.label, x.uniqueUsers.value, x.uses.value, chg(x.uses.change), x.frequency, pct(x.adoption), x.abandonment ? (pct(x.abandonment.rate) ?? "n/d") : "—", `${x.errors.count}${x.errors.rate != null ? ` (${x.errors.rate} %)` : ""}`, x.avgProcessingMs])},
          { title: "Ouvertures de modules", columns: ["Module", "Ouvertures", "Utilisateurs"], rows: f.modules.map((m): Cell[] => [m.label, m.opens, m.users]) },
          { title: "Suggestions de révision", columns: ["Affichées", "Suivies", "Écartées", "En attente", "Taux de suivi"], rows: [[f.recommendations.shown, f.recommendations.followed, f.recommendations.dismissed, f.recommendations.pending, pct(f.recommendations.followRate)]] },
          { title: "À améliorer", columns: ["Fonctionnalité", "Raisons"], rows: f.needsWork.map((x): Cell[] => [x.feature.label, x.reasons.join(" ; ")]) },
        ],
        charts: [{ title: "Utilisations par fonctionnalité", kind: "bar", labels: f.features.map((x) => x.label), values: f.features.map((x) => x.uses.value ?? 0) }],
      };
    }
    case "hours": {
      const h = await getHeatmap(period, "events");
      return {
        ...base, key, title: "Tendances horaires",
        notes: [...base.notes, ...h.insights],
        tables: [{ title: "Actions significatives par jour et par heure (UTC)", columns: ["Jour", ...Array.from({ length: 24 }, (_, i) => `${i} h`)], rows: h.cells.map((row, d): Cell[] => [WEEKDAYS[d], ...row]) }],
        charts: [{ title: "Activité par heure", kind: "bar", labels: h.hourTotals.map((_, i) => `${i} h`), values: h.hourTotals }],
      };
    }
    case "pedagogy": {
      const p = await getPedagogy(period);
      const e = p.exercises;
      return {
        ...base, key, title: "Progression pédagogique globale", notes: [...base.notes, ...p.notices],
        tables: [
          { title: "Exercices", columns: ["Indicateur", "Valeur", "Période précédente", "Évolution"], rows: [["Exercices créés", e.generated], ["Exercices commencés", e.started], ["Exercices terminés", e.completed], ["Exercices abandonnés", e.abandoned], ["Taux de réussite (%)", e.successRate]].map(([l, m]): Cell[] => { const x = m as typeof e.generated; return [l as string, x.value, x.previous, chg(x.change)]; }) },
          { title: "Matières les plus travaillées", columns: ["Matière", "Tentatives", "Étudiants", "Évolution"], rows: p.subjects.ranking.map((s): Cell[] => [s.label, s.value, s.users ?? null, chg(s.change ?? null)]) },
          { title: "Taux de réussite par matière", columns: ["Matière", "Réussite (%)", "Exercices terminés"], rows: p.progress.successBySubject.map((s): Cell[] => [s.label, s.value, s.extra ?? null]) },
          { title: "Environnements pratiques", columns: ["Environnement", "Espaces créés", "Étudiants", "Exécutions", "Avec tests", "Tests réussis", "Erreurs"], rows: p.environments.map((x): Cell[] => [x.label, x.workspaces, x.users, x.runs, x.testedRuns, x.passedRuns, x.errors]) },
          { title: "Notions les plus travaillées", columns: ["Notion", "Réponses", "Étudiants"], rows: p.progress.topConcepts.map((c): Cell[] => [c.label, c.value, c.users ?? null]) },
          { title: "Notions les plus difficiles", columns: ["Notion", "Taux d'erreur (%)", "Réponses"], rows: p.progress.difficulties.map((c): Cell[] => [c.label, c.value, c.extra ?? null]) },
        ],
        charts: [{ title: "Taux de réussite", kind: "line", labels: p.progress.successSeries.map((s) => label(period)(s.bucket)), values: p.progress.successSeries.map((s) => s.value ?? 0) }],
      };
    }
    case "requests": {
      const r = await getRequestAnalytics(period);
      return {
        ...base, key, title: "Suggestions et demandes reçues",
        tables: [
          { title: "Synthèse", columns: ["Indicateur", "Valeur"], rows: [["Demandes reçues", r.total], ["Période précédente", r.previous], ["Évolution", chg(r.change)], ["Délai moyen de première réponse (h)", r.avgFirstReplyHours], ["Délai moyen de traitement (h)", r.avgResolutionHours], ["Demandes clôturées", r.resolvedCount]] },
          { title: "Par type", columns: ["Type", "Demandes"], rows: r.byType.map((t): Cell[] => [t.label, t.value]) },
          { title: "Par module", columns: ["Module", "Demandes", "Dont problèmes"], rows: r.byModule.map((t): Cell[] => [t.label, t.value, t.problems]) },
          { title: "Besoins récurrents (feuille de route)", columns: ["Besoin", "Statut", "Demandes", "Étudiants"], rows: r.recurring.map((t): Cell[] => [t.title, t.status, t.requests, t.users]) },
        ],
        charts: [{ title: "Demandes dans le temps", kind: "bar", labels: r.series.map((s) => label(period)(s.bucket)), values: r.series.map((s) => s.value) }],
      };
    }
    case "tech": {
      const t = await getTechReport(period, opts.module ?? null);
      return {
        ...base, key, title: "Performances techniques", notes: [...base.notes, ...t.notices],
        tables: [
          { title: "Synthèse", columns: ["Indicateur", "Valeur"], rows: [["Requêtes mesurées", t.requests], ["Disponibilité (trafic réel, %)", t.availability], ["Taux d'erreurs (%)", t.errorRate], ["Erreurs serveur", t.serverErrors], ["Temps de réponse moyen (ms)", t.avgMs], ["Médiane (ms)", t.p50Ms], ["95e percentile (ms)", t.p95Ms], ["Erreurs utilisateur", t.byKind.USER], ["Erreurs applicatives", t.byKind.APP], ["Erreurs de services externes", t.byKind.EXTERNAL]] },
          { title: "Routes les plus lentes", columns: ["Route", "Méthode", "Requêtes", "Moyenne (ms)", "95e percentile (ms)"], rows: t.slowest.map((r): Cell[] => [r.route, r.method, r.count, r.avgMs, r.p95Ms]) },
          { title: "Erreurs fréquentes", columns: ["Route", "Méthode", "Statut", "Classe", "Occurrences"], rows: t.frequentErrors.map((r): Cell[] => [r.route, r.method, r.status, r.kind, r.count]) },
        ],
        charts: [{ title: "Requêtes", kind: "line", labels: t.series.map((s) => label(period)(s.bucket)), values: t.series.map((s) => s.requests) }],
      };
    }
    case "ai": {
      const a = await getAiReport(period);
      return {
        ...base, key, title: "Utilisation de l'intelligence artificielle", notes: [...base.notes, ...a.unavailable],
        tables: [
          { title: "Synthèse", columns: ["Indicateur", "Valeur"], rows: [["Appels", a.calls.value], ["Évolution", chg(a.calls.change)], ["Réussis", a.ok], ["Échoués", a.failed], ["Taux d'échec (%)", a.failureRate], ["Temps moyen (ms)", a.avgMs], ["Générations d'exercices", a.generations], ["Analyses de documents", a.documentAnalyses], ["Corrections et assistances", a.assistances]] },
          { title: "Par fonctionnalité", columns: ["Fonctionnalité", "Appels", "Échecs", "Temps moyen (ms)", "Volume (caractères)"], rows: a.byFeature.map((f): Cell[] => [f.label, f.calls, f.failed, f.avgMs, f.chars]) },
          { title: "Par modèle", columns: ["Modèle", "Appels", "Échecs", "Temps moyen (ms)"], rows: a.byModel.map((m): Cell[] => [m.model, m.calls, m.failed, m.avgMs]) },
        ],
        charts: [{ title: "Appels IA", kind: "line", labels: a.series.map((s) => label(period)(s.bucket)), values: a.series.map((s) => s.calls) }],
      };
    }
    default:
      throw new Error("Rapport inconnu.");
  }
}

