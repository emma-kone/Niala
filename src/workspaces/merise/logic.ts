import { newId, type Association, type Cardinality, type Dependency, type DictionaryItem, type Entity, type Mcd, type MeriseWork, type MldTable, type MpdTable } from "./model";

// ─────────────────────────────────────────────────────────────────────────────
// Règles Merise : contrôles de cohérence, passage MCD → MLD → MPD, génération SQL, dépendances fonctionnelles.
// Fonctions pures : l'étudiant vérifie et corrige le résultat ; rien n'est imposé en silence.
// ─────────────────────────────────────────────────────────────────────────────

export type IssueLevel = "error" | "warning" | "info";
export interface Issue {
  level: IssueLevel;
  area: "dictionnaire" | "dependances" | "mcd" | "mld" | "mpd" | "mct" | "flux";
  message: string;
}

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const singular = (w: string) => w.replace(/(x|s)$/, "");
const key = (s: string) => fold(s).split(" ").map(singular).join(" ");

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
/** Deux noms désignent-ils la même chose ? Insensible à la casse, aux accents, au pluriel et aux fautes de frappe légères. */
export function similar(a: string, b: string): boolean {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const tolerance = Math.min(x.length, y.length) >= 9 ? 2 : Math.min(x.length, y.length) >= 5 ? 1 : 0;
  return tolerance > 0 && distance(x, y) <= tolerance;
}

const maxOf = (c: Cardinality) => (c.endsWith("N") ? "N" : "1");
const minOf = (c: Cardinality) => c.charAt(0);
const cleanName = (s: string) => fold(s).replace(/ /g, "_") || "sans_nom";

// ── Dictionnaire de données ──────────────────────────────────────────────────

export function dictionaryIssues(items: DictionaryItem[]): Issue[] {
  const out: Issue[] = [];
  const seen = new Map<string, string>();
  for (const d of items) {
    const name = d.code.trim() || d.label.trim() || "(sans nom)";
    if (!d.code.trim()) out.push({ level: "error", area: "dictionnaire", message: `Une donnée n'a pas de code (${d.label.trim() || "ligne vide"}).` });
    else {
      const k = fold(d.code);
      if (seen.has(k)) out.push({ level: "error", area: "dictionnaire", message: `Doublon : le code « ${d.code} » est utilisé deux fois.` });
      seen.set(k, d.id);
    }
    if (!d.label.trim()) out.push({ level: "warning", area: "dictionnaire", message: `« ${name} » n'a pas de désignation.` });
    if (!d.type.trim()) out.push({ level: "warning", area: "dictionnaire", message: `« ${name} » n'a pas de type.` });
    if (d.size.trim() && !/^\d+(,\d+)?$/.test(d.size.trim())) out.push({ level: "warning", area: "dictionnaire", message: `La taille de « ${name} » doit être un nombre (ex. 30 ou 8,2).` });
    if (d.nature === "calculee" && !d.rule.trim()) out.push({ level: "warning", area: "dictionnaire", message: `« ${name} » est calculée : indiquez sa règle de calcul.` });
  }
  const labels = new Map<string, string>();
  for (const d of items) {
    const k = fold(d.label);
    if (k && labels.has(k) && labels.get(k) !== fold(d.code)) out.push({ level: "info", area: "dictionnaire", message: `Deux données ont la même désignation « ${d.label} » : sont-elles distinctes ?` });
    if (k) labels.set(k, fold(d.code));
  }
  return out;
}

export function dictionaryToCsv(items: DictionaryItem[]): string {
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ["Code", "Désignation", "Type", "Taille", "Format", "Nature", "Description", "Règle de gestion", "Observations"];
  const rows = items.map((d) => [d.code, d.label, d.type, d.size, d.format, d.nature === "calculee" ? "Calculée" : "Élémentaire", d.description, d.rule, d.notes].map(cell).join(";"));
  return `﻿${[head.join(";"), ...rows].join("\r\n")}\r\n`;
}

// ── Dépendances fonctionnelles ───────────────────────────────────────────────

/** Fermeture d'un ensemble d'attributs par un ensemble de dépendances. */
export function closure(attrs: string[], deps: { from: string[]; to: string[] }[]): Set<string> {
  const out = new Set(attrs.map(fold));
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of deps) {
      if (d.from.length && d.from.every((a) => out.has(fold(a)))) for (const t of d.to) if (!out.has(fold(t))) (out.add(fold(t)), (grew = true));
    }
  }
  return out;
}

export function dependencyIssues(deps: Dependency[], dictionary: DictionaryItem[]): Issue[] {
  const out: Issue[] = [];
  const known = new Set(dictionary.map((d) => fold(d.code)).filter(Boolean));
  const label = (d: Dependency) => `${d.from.join(", ") || "?"} → ${d.to.join(", ") || "?"}`;
  deps.forEach((d, i) => {
    if (d.from.length === 0 || d.to.length === 0) out.push({ level: "error", area: "dependances", message: `La dépendance n° ${i + 1} est incomplète (${label(d)}).` });
    for (const c of [...d.from, ...d.to]) if (known.size && !known.has(fold(c))) out.push({ level: "warning", area: "dependances", message: `« ${c} » (${label(d)}) ne figure pas dans le dictionnaire de données.` });
    if (d.to.some((t) => d.from.some((f) => fold(f) === fold(t)))) out.push({ level: "warning", area: "dependances", message: `Dépendance triviale : ${label(d)} (une donnée ne détermine pas ce qu'elle contient déjà).` });
    const calc = dictionary.find((x) => d.from.some((f) => fold(f) === fold(x.code)) && x.nature === "calculee");
    if (calc) out.push({ level: "warning", area: "dependances", message: `« ${calc.code} » est une donnée calculée : elle ne devrait pas être la source d'une dépendance (${label(d)}).` });
  });
  // Dépendance redondante : déductible des autres.
  deps.forEach((d, i) => {
    if (d.from.length === 0 || d.to.length === 0) return;
    const others = deps.filter((_, j) => j !== i);
    const reach = closure(d.from, others);
    const redundant = d.to.filter((t) => reach.has(fold(t)) && !d.from.some((f) => fold(f) === fold(t)));
    if (redundant.length === d.to.length) out.push({ level: "info", area: "dependances", message: `Dépendance redondante : ${label(d)} se déduit des autres (transitivité).` });
  });
  return out;
}

/** Clés candidates minimales d'un ensemble d'attributs (jusqu'à 14 attributs, au-delà le calcul est refusé). */
export function candidateKeys(attrs: string[], deps: { from: string[]; to: string[] }[]): string[][] | null {
  const all = [...new Set(attrs.map((a) => a.trim()).filter(Boolean))];
  if (all.length === 0 || all.length > 14) return all.length === 0 ? [] : null;
  const rhs = new Set(deps.flatMap((d) => d.to.map(fold)));
  const must = all.filter((a) => !rhs.has(fold(a)));
  const optional = all.filter((a) => rhs.has(fold(a)));
  const target = new Set(all.map(fold));
  const keys: string[][] = [];
  for (let size = 0; size <= optional.length; size++) {
    const pick = (start: number, cur: string[]) => {
      if (cur.length === size) {
        const k = [...must, ...cur];
        if (keys.some((x) => x.every((a) => k.includes(a)))) return;
        const c = closure(k, deps);
        if ([...target].every((a) => c.has(a))) keys.push(k);
        return;
      }
      for (let i = start; i < optional.length; i++) pick(i + 1, [...cur, optional[i]]);
    };
    pick(0, []);
  }
  return keys;
}

// ── MCD ──────────────────────────────────────────────────────────────────────

export function mcdIssues(mcd: Mcd, dictionary: DictionaryItem[]): Issue[] {
  const out: Issue[] = [];
  const byId = new Map(mcd.entities.map((e) => [e.id, e]));
  const dictCodes = new Set(dictionary.flatMap((d) => [fold(d.code), fold(d.label)]).filter(Boolean));
  const calculated = new Set(dictionary.filter((d) => d.nature === "calculee").flatMap((d) => [fold(d.code), fold(d.label)]));
  const names = new Map<string, number>();
  for (const e of mcd.entities) {
    const n = e.name.trim() || "(entité sans nom)";
    if (!e.name.trim()) out.push({ level: "error", area: "mcd", message: "Une entité n'a pas de nom." });
    else if (names.has(key(e.name))) out.push({ level: "error", area: "mcd", message: `Deux entités portent le même nom « ${e.name} ».` });
    names.set(key(e.name), 1);
    if (!e.attributes.some((a) => a.isId)) out.push({ level: "error", area: "mcd", message: `L'entité « ${n} » n'a pas d'identifiant.` });
    const seen = new Set<string>();
    for (const a of e.attributes) {
      const k = fold(a.name);
      if (!k) out.push({ level: "warning", area: "mcd", message: `Une propriété de « ${n} » n'a pas de nom.` });
      else if (seen.has(k)) out.push({ level: "error", area: "mcd", message: `« ${n} » contient deux fois la propriété « ${a.name} ».` });
      seen.add(k);
      if (k && calculated.has(k)) out.push({ level: "warning", area: "mcd", message: `« ${a.name} » (${n}) est une donnée calculée : elle n'a pas sa place dans un MCD.` });
      else if (k && dictCodes.size && !dictCodes.has(k)) out.push({ level: "info", area: "mcd", message: `« ${a.name} » (${n}) n'est pas dans le dictionnaire de données.` });
    }
  }
  for (const a of mcd.associations) {
    const n = a.name.trim() || "(association sans nom)";
    if (!a.name.trim()) out.push({ level: "warning", area: "mcd", message: "Une association n'a pas de nom (un verbe, en général)." });
    if (a.links.length < 2 && a.links.length > 0) out.push({ level: "error", area: "mcd", message: `L'association « ${n} » doit relier au moins deux entités.` });
    if (a.links.length === 0) out.push({ level: "error", area: "mcd", message: `L'association « ${n} » n'est reliée à aucune entité.` });
    for (const l of a.links) if (!byId.has(l.entityId)) out.push({ level: "error", area: "mcd", message: `L'association « ${n} » pointe vers une entité supprimée.` });
    if (a.attributes.length && a.links.length === 2 && a.links.some((l) => maxOf(l.card) === "1")) out.push({ level: "warning", area: "mcd", message: `« ${n} » porte des propriétés alors qu'une de ses cardinalités maximales est 1 : ces propriétés appartiennent plutôt à l'entité du côté « 1 ».` });
  }
  const used = new Set(mcd.associations.flatMap((a) => a.links.map((l) => l.entityId)));
  for (const e of mcd.entities) if (mcd.associations.length > 0 && !used.has(e.id)) out.push({ level: "warning", area: "mcd", message: `L'entité « ${e.name || "(sans nom)"} » n'est reliée à aucune association.` });
  return out;
}

// ── MCD → MLD ────────────────────────────────────────────────────────────────

export function mcdToMld(mcd: Mcd): MldTable[] {
  const tableOf = new Map<string, MldTable>();
  const taken = new Set<string>();
  const uniqueName = (base: string) => {
    let n = cleanName(base);
    for (let i = 2; taken.has(n); i++) n = `${cleanName(base)}_${i}`;
    taken.add(n);
    return n;
  };
  const pkOf = (e: Entity) => e.attributes.filter((a) => a.isId).map((a) => cleanName(a.name));
  for (const e of mcd.entities) {
    const t: MldTable = { id: newId("t"), name: uniqueName(e.name), columns: [] };
    for (const a of e.attributes) t.columns.push({ id: newId("c"), name: cleanName(a.name), pk: a.isId, fkTable: "", fkColumn: "" });
    tableOf.set(e.id, t);
  }
  const addFk = (target: MldTable, ref: Entity, refTable: MldTable, asPk: boolean, role = "") => {
    for (const pk of pkOf(ref)) {
      let col = role ? `${role}_${pk}` : pk;
      for (let i = 2; target.columns.some((c) => c.name === col); i++) col = `${role || refTable.name}_${pk}_${i}`;
      target.columns.push({ id: newId("c"), name: col, pk: asPk, fkTable: refTable.name, fkColumn: pk });
    }
  };
  const extra: MldTable[] = [];
  for (const a of mcd.associations) {
    const links = a.links.filter((l) => tableOf.has(l.entityId));
    if (links.length < 2) continue;
    const ents = links.map((l) => ({ l, e: mcd.entities.find((x) => x.id === l.entityId)!, t: tableOf.get(l.entityId)! }));
    const oneSide = ents.length === 2 ? ents.filter((x) => maxOf(x.l.card) === "1") : [];
    if (ents.length === 2 && oneSide.length >= 1) {
      // L'entité qui participe au plus une fois reçoit la clé de l'autre ; entre deux « 1 », on préfère celle en (1,1).
      const holder = oneSide.length === 2 ? (oneSide.find((x) => minOf(x.l.card) === "1") ?? oneSide[0]) : oneSide[0];
      const other = ents.find((x) => x !== holder)!;
      const role = other.e === holder.e ? cleanName(a.name) : "";
      addFk(holder.t, other.e, other.t, false, role);
      for (const attr of a.attributes) holder.t.columns.push({ id: newId("c"), name: cleanName(attr.name), pk: false, fkTable: "", fkColumn: "" });
    } else {
      // Plusieurs-à-plusieurs, ou association ternaire et plus : l'association devient une table, clé = concaténation des clés.
      const t: MldTable = { id: newId("t"), name: uniqueName(a.name || ents.map((x) => x.t.name).join("_")), columns: [] };
      ents.forEach((x, i) => addFk(t, x.e, x.t, true, ents.filter((y) => y.e === x.e).length > 1 ? `${cleanName(a.name)}${i + 1}` : ""));
      for (const attr of a.attributes) t.columns.push({ id: newId("c"), name: cleanName(attr.name), pk: false, fkTable: "", fkColumn: "" });
      extra.push(t);
    }
  }
  return [...tableOf.values(), ...extra];
}

/** Écarts entre le MLD de l'étudiant et celui que les règles de passage donneraient pour son MCD. */
export function mldIssues(student: MldTable[], mcd: Mcd): Issue[] {
  if (mcd.entities.length === 0) return [];
  const out: Issue[] = [];
  const expected = mcdToMld(mcd);
  for (const t of expected) {
    const found = student.find((s) => similar(s.name, t.name));
    if (!found) {
      out.push({ level: "warning", area: "mld", message: `Table attendue absente : « ${t.name} ».` });
      continue;
    }
    for (const c of t.columns) {
      const col = found.columns.find((x) => similar(x.name, c.name));
      if (!col) out.push({ level: "warning", area: "mld", message: `La table « ${t.name} » devrait contenir la colonne « ${c.name} ».` });
      else {
        if (c.pk && !col.pk) out.push({ level: "error", area: "mld", message: `« ${t.name}.${c.name} » devrait faire partie de la clé primaire.` });
        if (c.fkTable && !col.fkTable) out.push({ level: "error", area: "mld", message: `« ${t.name}.${c.name} » devrait être une clé étrangère vers « ${c.fkTable} ».` });
      }
    }
  }
  for (const s of student) if (!expected.some((t) => similar(t.name, s.name))) out.push({ level: "info", area: "mld", message: `La table « ${s.name} » ne correspond à aucune entité ou association du MCD.` });
  for (const t of student) for (const c of t.columns) if (c.fkTable && !student.some((x) => similar(x.name, c.fkTable))) out.push({ level: "error", area: "mld", message: `« ${t.name}.${c.name} » référence une table inexistante « ${c.fkTable} ».` });
  return out;
}

// ── MLD → MPD → SQL ──────────────────────────────────────────────────────────

export function mldToMpd(tables: MldTable[], dictionary: DictionaryItem[]): MpdTable[] {
  const info = (name: string) => dictionary.find((d) => similar(d.code, name) || similar(d.label, name));
  const typeOf = (name: string, pk: boolean, fk: boolean): { type: string; size: string } => {
    const d = info(name);
    if (d?.type) {
      const t = d.type.toUpperCase();
      if (t === "N") return d.size.includes(",") ? { type: "DECIMAL", size: d.size } : { type: "INTEGER", size: "" };
      if (t === "D") return { type: "DATE", size: "" };
      if (t === "B") return { type: "BOOLEAN", size: "" };
      if (t === "T") return { type: "TEXT", size: "" };
      return { type: "VARCHAR", size: d.size || "255" };
    }
    return pk || fk || /(^|_)id($|_)|code|num/.test(name) ? { type: "INTEGER", size: "" } : { type: "VARCHAR", size: "255" };
  };
  return tables.map((t) => ({
    id: newId("t"),
    name: t.name,
    columns: t.columns.map((c) => ({ ...c, id: newId("c"), ...typeOf(c.name, c.pk, !!c.fkTable), notNull: c.pk, unique: false })),
  }));
}

export function mpdIssues(tables: MpdTable[]): Issue[] {
  const out: Issue[] = [];
  for (const t of tables) {
    if (!t.columns.some((c) => c.pk)) out.push({ level: "error", area: "mpd", message: `La table « ${t.name} » n'a pas de clé primaire.` });
    for (const c of t.columns) {
      if (!c.type.trim()) out.push({ level: "error", area: "mpd", message: `« ${t.name}.${c.name} » n'a pas de type.` });
      if (c.fkTable) {
        const ref = tables.find((x) => cleanName(x.name) === cleanName(c.fkTable));
        if (!ref) out.push({ level: "error", area: "mpd", message: `« ${t.name}.${c.name} » référence la table inexistante « ${c.fkTable} ».` });
        else if (!ref.columns.some((x) => cleanName(x.name) === cleanName(c.fkColumn))) out.push({ level: "error", area: "mpd", message: `« ${t.name}.${c.name} » référence une colonne inexistante « ${ref.name}.${c.fkColumn} ».` });
        else {
          const target = ref.columns.find((x) => cleanName(x.name) === cleanName(c.fkColumn))!;
          if (target.type && c.type && target.type.toUpperCase() !== c.type.toUpperCase()) out.push({ level: "warning", area: "mpd", message: `« ${t.name}.${c.name} » (${c.type}) et « ${ref.name}.${target.name} » (${target.type}) n'ont pas le même type.` });
        }
      }
    }
  }
  return out;
}

export function mpdToSql(tables: MpdTable[]): string {
  const ident = cleanName;
  const ordered: MpdTable[] = [];
  const done = new Set<string>();
  const pending = [...tables];
  // Les tables référencées d'abord ; en cas de dépendance circulaire, le reste suit avec ses clés étrangères en fin de script.
  for (let guard = 0; pending.length && guard <= tables.length + 1; guard++) {
    for (let i = 0; i < pending.length; i++) {
      const t = pending[i];
      if (t.columns.every((c) => !c.fkTable || cleanName(c.fkTable) === ident(t.name) || done.has(ident(c.fkTable)) || !tables.some((x) => ident(x.name) === ident(c.fkTable)))) {
        ordered.push(t);
        done.add(ident(t.name));
        pending.splice(i--, 1);
      }
    }
  }
  const circular = pending;
  const stmt = (t: MpdTable, withFk: boolean) => {
    const cols = t.columns.map((c) => `  ${ident(c.name)} ${(c.type || "VARCHAR").toUpperCase()}${c.size && /^(VARCHAR|CHAR|DECIMAL|NUMERIC)$/i.test(c.type) ? `(${c.size})` : ""}${c.notNull || c.pk ? " NOT NULL" : ""}${c.unique ? " UNIQUE" : ""}`);
    const pk = t.columns.filter((c) => c.pk).map((c) => ident(c.name));
    if (pk.length) cols.push(`  PRIMARY KEY (${pk.join(", ")})`);
    if (withFk) for (const c of t.columns.filter((x) => x.fkTable)) cols.push(`  FOREIGN KEY (${ident(c.name)}) REFERENCES ${ident(c.fkTable)}(${ident(c.fkColumn)})`);
    return `CREATE TABLE ${ident(t.name)} (\n${cols.join(",\n")}\n);`;
  };
  const alters = circular.flatMap((t) => t.columns.filter((c) => c.fkTable).map((c) => `ALTER TABLE ${ident(t.name)} ADD FOREIGN KEY (${ident(c.name)}) REFERENCES ${ident(c.fkTable)}(${ident(c.fkColumn)});`));
  return [...ordered.map((t) => stmt(t, true)), ...circular.map((t) => stmt(t, false)), ...alters].join("\n\n");
}

// ── MCT et flux ──────────────────────────────────────────────────────────────

export function mctIssues(mct: MeriseWork["mct"]): Issue[] {
  const out: Issue[] = [];
  const incoming = (id: string) => mct.edges.filter((e) => e.to === id).length;
  const outgoing = (id: string) => mct.edges.filter((e) => e.from === id).length;
  const ids = new Set(mct.nodes.map((n) => n.id));
  for (const e of mct.edges) if (!ids.has(e.from) || !ids.has(e.to)) out.push({ level: "error", area: "mct", message: "Un lien du MCT pointe vers un élément supprimé." });
  for (const n of mct.nodes) {
    const name = n.label.trim() || "(sans libellé)";
    if (!n.label.trim()) out.push({ level: "warning", area: "mct", message: "Un élément du MCT n'a pas de libellé." });
    if (n.kind === "event" && outgoing(n.id) === 0) out.push({ level: "warning", area: "mct", message: `L'événement « ${name} » ne déclenche aucune opération.` });
    if (n.kind === "operation" && incoming(n.id) === 0) out.push({ level: "error", area: "mct", message: `L'opération « ${name} » n'est déclenchée par aucun événement ni synchronisation.` });
    if (n.kind === "operation" && outgoing(n.id) === 0) out.push({ level: "warning", area: "mct", message: `L'opération « ${name} » ne produit aucun résultat.` });
    if (n.kind === "result" && incoming(n.id) === 0) out.push({ level: "warning", area: "mct", message: `Le résultat « ${name} » n'est produit par aucune opération.` });
    if (n.kind === "sync" && incoming(n.id) < 2) out.push({ level: "warning", area: "mct", message: `La synchronisation « ${name} » doit rassembler au moins deux événements.` });
    if (n.kind === "sync" && !n.rule.trim()) out.push({ level: "info", area: "mct", message: `Indiquez la règle (condition) de la synchronisation « ${name} ».` });
  }
  return out;
}

export function flowIssues(f: MeriseWork["flows"]): Issue[] {
  const out: Issue[] = [];
  const ids = new Set(f.actors.map((a) => a.id));
  for (const fl of f.flows) {
    if (!ids.has(fl.from) || !ids.has(fl.to)) out.push({ level: "error", area: "flux", message: "Un flux relie un acteur supprimé." });
    if (fl.from === fl.to) out.push({ level: "warning", area: "flux", message: "Un flux relie un acteur à lui-même." });
    if (!fl.label.trim()) out.push({ level: "warning", area: "flux", message: "Un flux n'a pas de libellé (nature de l'information échangée)." });
  }
  for (const a of f.actors) if (f.flows.length > 0 && !f.flows.some((x) => x.from === a.id || x.to === a.id)) out.push({ level: "warning", area: "flux", message: `L'acteur « ${a.name || "(sans nom)"} » n'échange aucun flux.` });
  return out;
}

/** Tous les contrôles de cohérence, pour l'ensemble de l'atelier. */
export function meriseIssues(w: MeriseWork): Issue[] {
  return [
    ...dictionaryIssues(w.dictionary),
    ...dependencyIssues(w.dependencies, w.dictionary),
    ...mcdIssues(w.mcd, w.dictionary),
    ...(w.mld.tables.length ? mldIssues(w.mld.tables, w.mcd) : []),
    ...mpdIssues(w.mpd.tables),
    ...mctIssues(w.mct),
    ...flowIssues(w.flows),
  ];
}

export const cardLabel = (c: Cardinality) => c;
export type { Association };
