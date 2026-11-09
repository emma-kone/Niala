import { mcdToMld, meriseIssues, mldIssues, similar } from "./logic";
import type { MeriseReference, MeriseWork } from "./model";

// ─────────────────────────────────────────────────────────────────────────────
// Correction d'un atelier Merise face à une solution de référence STRUCTURÉE. Les noms sont comparés sans tenir compte
// de la casse, des accents, du pluriel ni de fautes légères ; l'ordre et la disposition ne comptent pas. Une solution
// différente mais cohérente n'est pas rejetée ici : ce score est un plancher que l'évaluation qualitative peut relever.
// ─────────────────────────────────────────────────────────────────────────────

export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}
export interface MeriseGrade {
  ratio: number;
  checks: Check[];
  /** Cohérence interne : nombre d'erreurs détectées dans l'atelier (indépendamment de la référence). */
  errors: number;
}

const maxCard = (c: string) => (c.endsWith("N") ? "N" : "1");

export function gradeMerise(work: MeriseWork, ref: MeriseReference): MeriseGrade {
  const checks: Check[] = [];
  const parts: { weight: number; score: number }[] = [];
  const wants = new Set(ref.deliverables);

  if (wants.has("mcd")) {
    // Correspondance entités de référence → entités de l'étudiant
    const match = new Map<string, string>();
    let found = 0;
    for (const re of ref.entities) {
      const se = work.mcd.entities.find((e) => similar(e.name, re.name));
      if (se) {
        match.set(re.name, se.id);
        found++;
      }
      checks.push({ label: `Entité « ${re.name} »`, ok: !!se, detail: se ? undefined : "absente du MCD" });
    }
    if (ref.entities.length) parts.push({ weight: 0.3, score: found / ref.entities.length });

    // Identifiants et propriétés des entités retrouvées
    let idOk = 0;
    let idTotal = 0;
    let attrOk = 0;
    let attrTotal = 0;
    for (const re of ref.entities) {
      const se = work.mcd.entities.find((e) => e.id === match.get(re.name));
      if (!se) {
        idTotal += re.identifier.length;
        attrTotal += re.attributes.length;
        continue;
      }
      for (const idName of re.identifier) {
        idTotal++;
        const ok = se.attributes.some((a) => a.isId && similar(a.name, idName));
        if (ok) idOk++;
        checks.push({ label: `Identifiant « ${idName} » de ${re.name}`, ok, detail: ok ? undefined : "manquant ou non marqué comme identifiant" });
      }
      for (const attr of re.attributes) {
        attrTotal++;
        if (se.attributes.some((a) => similar(a.name, attr))) attrOk++;
      }
    }
    if (idTotal) parts.push({ weight: 0.15, score: idOk / idTotal });
    if (attrTotal) parts.push({ weight: 0.1, score: attrOk / attrTotal });

    // Associations : même ensemble d'entités reliées, quel que soit le nom choisi
    let assocOk = 0;
    let cardOk = 0;
    let cardTotal = 0;
    for (const ra of ref.associations) {
      const wantedIds = ra.links.map((l) => match.get(l.entity));
      const label = ra.name || ra.links.map((l) => l.entity).join(" – ");
      const sa = wantedIds.every(Boolean)
        ? work.mcd.associations.find((a) => a.links.length === ra.links.length && ra.links.every((l) => a.links.some((x) => x.entityId === match.get(l.entity))))
        : undefined;
      if (sa) assocOk++;
      checks.push({ label: `Association « ${label} »`, ok: !!sa, detail: sa ? undefined : "absente ou reliant d'autres entités" });
      for (const l of ra.links) {
        cardTotal++;
        const sl = sa?.links.find((x) => x.entityId === match.get(l.entity));
        const exact = sl?.card === l.card;
        // Moitié des points quand seule la cardinalité maximale est juste.
        if (exact) cardOk++;
        else if (sl && maxCard(sl.card) === maxCard(l.card)) cardOk += 0.5;
        checks.push({ label: `Cardinalité ${l.entity} (${label})`, ok: !!exact, detail: sl ? (exact ? undefined : `${sl.card} au lieu de ${l.card}`) : "association absente" });
      }
    }
    if (ref.associations.length) {
      parts.push({ weight: 0.25, score: assocOk / ref.associations.length });
      parts.push({ weight: 0.2, score: cardTotal ? cardOk / cardTotal : 0 });
    }
  }

  if (wants.has("mld")) {
    const expected = mcdToMld(work.mcd);
    const issues = work.mld.tables.length ? mldIssues(work.mld.tables, work.mcd).filter((i) => i.level !== "info") : [];
    const score = work.mld.tables.length === 0 || expected.length === 0 ? 0 : Math.max(0, 1 - issues.length / Math.max(1, expected.reduce((n, t) => n + t.columns.length, 0)));
    parts.push({ weight: 0.2, score });
    checks.push({ label: "MLD cohérent avec le MCD", ok: score >= 0.99, detail: work.mld.tables.length === 0 ? "MLD vide" : issues.length ? `${issues.length} écart(s)` : undefined });
  }
  if (wants.has("dictionary")) {
    const ok = work.dictionary.length > 0 && !meriseIssues({ ...emptyLike(work), dictionary: work.dictionary }).some((i) => i.area === "dictionnaire" && i.level === "error");
    parts.push({ weight: 0.1, score: ok ? 1 : 0 });
    checks.push({ label: "Dictionnaire de données renseigné et sans doublon", ok });
  }
  if (wants.has("dependencies")) {
    const ok = work.dependencies.length > 0;
    parts.push({ weight: 0.1, score: ok ? 1 : 0 });
    checks.push({ label: "Dépendances fonctionnelles saisies", ok });
  }
  if (wants.has("mpd")) {
    const ok = work.mpd.tables.length > 0 && !meriseIssues({ ...emptyLike(work), mpd: work.mpd }).some((i) => i.area === "mpd" && i.level === "error");
    parts.push({ weight: 0.1, score: ok ? 1 : 0 });
    checks.push({ label: "MPD complet (types, clés)", ok });
  }
  if (wants.has("mct")) {
    const ok = work.mct.nodes.length > 0 && !meriseIssues({ ...emptyLike(work), mct: work.mct }).some((i) => i.area === "mct" && i.level === "error");
    parts.push({ weight: 0.15, score: ok ? 1 : 0 });
    checks.push({ label: "MCT renseigné et cohérent", ok });
  }
  if (wants.has("flows")) {
    const ok = work.flows.actors.length > 0 && work.flows.flows.length > 0;
    parts.push({ weight: 0.1, score: ok ? 1 : 0 });
    checks.push({ label: "Flux entre acteurs saisis", ok });
  }
  const total = parts.reduce((s, p) => s + p.weight, 0);
  const ratio = total ? parts.reduce((s, p) => s + p.weight * p.score, 0) / total : 0;
  return { ratio: Math.max(0, Math.min(1, ratio)), checks, errors: meriseIssues(work).filter((i) => i.level === "error").length };
}

function emptyLike(w: MeriseWork): MeriseWork {
  return { ...w, dictionary: [], dependencies: [], mcd: { entities: [], associations: [] }, mld: { tables: [], edited: false }, mpd: { tables: [], edited: false }, mct: { nodes: [], edges: [] }, flows: { actors: [], flows: [] } };
}

/** Une production Merise est-elle vide ? (aucune ligne, aucun élément) */
export function isMeriseEmpty(w: MeriseWork): boolean {
  return !w.dictionary.length && !w.dependencies.length && !w.mcd.entities.length && !w.mcd.associations.length && !w.mld.tables.length && !w.mpd.tables.length && !w.mct.nodes.length && !w.flows.actors.length;
}
