import { describe, expect, it } from "vitest";
import { candidateKeys, closure, dependencyIssues, dictionaryIssues, dictionaryToCsv, mcdIssues, mcdToMld, meriseIssues, mldIssues, mldToMpd, mpdIssues, mpdToSql, similar } from "./logic";
import { gradeMerise, isMeriseEmpty } from "./grade";
import { emptyMerise, meriseReferenceSchema, readMerise, type Mcd } from "./model";

const attr = (name: string, isId = false) => ({ id: `a-${name}`, name, isId });
const ent = (name: string, attrs: ReturnType<typeof attr>[]) => ({ id: `e-${name}`, name, x: 0, y: 0, attributes: attrs });
const link = (e: string, card: "0,1" | "1,1" | "0,N" | "1,N") => ({ id: `l-${e}-${card}`, entityId: `e-${e}`, card });
const assoc = (name: string, links: ReturnType<typeof link>[], attrs: { id: string; name: string }[] = []) => ({ id: `as-${name}`, name, x: 0, y: 0, attributes: attrs, links });

// Un client passe des commandes ; une commande contient des produits (plusieurs-à-plusieurs, avec une quantité).
const MCD: Mcd = {
  entities: [ent("Client", [attr("idClient", true), attr("nom")]), ent("Commande", [attr("numCommande", true), attr("date")]), ent("Produit", [attr("refProduit", true), attr("libelle")])],
  associations: [assoc("Passer", [link("Client", "0,N"), link("Commande", "1,1")]), assoc("Contenir", [link("Commande", "1,N"), link("Produit", "0,N")], [{ id: "q", name: "quantite" }])],
};

describe("comparaison de noms", () => {
  it("ignore casse, accents, pluriel et fautes légères", () => {
    expect(similar("Étudiants", "etudiant")).toBe(true);
    expect(similar("Commande", "Commandes")).toBe(true);
    expect(similar("Livraison", "Livraisson")).toBe(true);
    expect(similar("Client", "Produit")).toBe(false);
    expect(similar("id", "ie")).toBe(false);
  });
});

describe("dictionnaire de données", () => {
  const item = (code: string, o: object = {}) => ({ id: code || "x", code, label: code, type: "AN", size: "20", format: "", description: "", nature: "elementaire" as const, rule: "", notes: "", ...o });
  it("détecte doublons, codes vides, tailles invalides et données calculées sans règle", () => {
    const msgs = dictionaryIssues([item("nom"), item("NOM"), item(""), item("age", { size: "abc" }), item("total", { nature: "calculee" })]).map((i) => i.message).join("|");
    expect(msgs).toContain("Doublon");
    expect(msgs).toContain("pas de code");
    expect(msgs).toContain("taille");
    expect(msgs).toContain("règle de calcul");
  });
  it("exporte en CSV avec guillemets protégés", () => {
    const csv = dictionaryToCsv([item("nom", { description: 'dit "bonjour"; ok' })]);
    expect(csv).toContain('"dit ""bonjour""; ok"');
    expect(csv.split("\r\n")[0]).toContain("Code;Désignation");
  });
});

describe("dépendances fonctionnelles", () => {
  const dep = (from: string[], to: string[]) => ({ id: from.join("") + to.join(""), from, to });
  it("calcule la fermeture et les clés candidates", () => {
    const deps = [dep(["idClient"], ["nom"]), dep(["numCommande"], ["date", "idClient"])];
    expect([...closure(["numCommande"], deps)].sort()).toEqual(["date", "idclient", "nom", "numcommande"]);
    expect(candidateKeys(["numCommande", "date", "idClient", "nom"], deps)).toEqual([["numCommande"]]);
  });
  it("signale une dépendance redondante, triviale et un code inconnu du dictionnaire", () => {
    const dict = ["a", "b", "c"].map((code) => ({ id: code, code, label: code, type: "AN", size: "", format: "", description: "", nature: "elementaire" as const, rule: "", notes: "" }));
    const m = dependencyIssues([dep(["a"], ["b"]), dep(["b"], ["c"]), dep(["a"], ["c"]), dep(["a"], ["a"]), dep(["z"], ["b"])], dict).map((i) => i.message).join("|");
    expect(m).toContain("redondante");
    expect(m).toContain("triviale");
    expect(m).toContain("« z »");
  });
});

describe("MCD", () => {
  it("accepte un MCD cohérent et détecte entité sans identifiant, association isolée, propriété d'une association (x,1)", () => {
    expect(mcdIssues(MCD, []).filter((i) => i.level === "error")).toEqual([]);
    const bad: Mcd = { entities: [ent("Client", [attr("nom")])], associations: [assoc("Seule", [link("Client", "0,N")]), assoc("Porteuse", [link("Client", "0,N"), link("Client", "1,1")], [{ id: "x", name: "date" }])] };
    const m = mcdIssues(bad, []).map((i) => i.message).join("|");
    expect(m).toContain("n'a pas d'identifiant");
    expect(m).toContain("au moins deux entités");
    expect(m).toContain("cardinalités maximales est 1");
  });
  it("signale une donnée calculée dans le MCD", () => {
    const dict = [{ id: "t", code: "total", label: "total", type: "N", size: "", format: "", description: "", nature: "calculee" as const, rule: "somme", notes: "" }];
    expect(mcdIssues({ entities: [ent("Commande", [attr("num", true), attr("total")])], associations: [] }, dict).map((i) => i.message).join("")).toContain("calculée");
  });
});

describe("passage MCD → MLD → MPD → SQL", () => {
  const tables = mcdToMld(MCD);
  const byName = (n: string) => tables.find((t) => t.name === n)!;
  it("place la clé étrangère du côté « 1 » (Commande reçoit idclient)", () => {
    expect(byName("commande").columns.find((c) => c.fkTable === "client")).toMatchObject({ name: "idclient", fkColumn: "idclient", pk: false });
    expect(byName("client").columns.some((c) => c.fkTable)).toBe(false);
  });
  it("transforme l'association plusieurs-à-plusieurs en table, clé composée, avec ses propriétés", () => {
    const t = byName("contenir");
    expect(t.columns.filter((c) => c.pk).map((c) => c.name).sort()).toEqual(["numcommande", "refproduit"]);
    expect(t.columns.find((c) => c.name === "quantite")).toMatchObject({ pk: false, fkTable: "" });
    expect(tables).toHaveLength(4);
  });
  it("gère une association réflexive et une ternaire", () => {
    const refl: Mcd = { entities: [ent("Employe", [attr("matricule", true)])], associations: [assoc("Dirige", [link("Employe", "0,1"), link("Employe", "0,N")])] };
    const t = mcdToMld(refl)[0];
    expect(t.columns.find((c) => c.fkTable === "employe")?.name).toBe("dirige_matricule");
    const tern: Mcd = { entities: [ent("A", [attr("ia", true)]), ent("B", [attr("ib", true)]), ent("C", [attr("ic", true)])], associations: [assoc("Lier", [link("A", "0,N"), link("B", "0,N"), link("C", "0,N")])] };
    const out = mcdToMld(tern);
    expect(out.find((x) => x.name === "lier")?.columns.filter((c) => c.pk)).toHaveLength(3);
  });
  it("génère un MPD typé d'après le dictionnaire, et un SQL ordonné avec ses clés", () => {
    const dict = [{ id: "d", code: "date", label: "date", type: "D", size: "", format: "", description: "", nature: "elementaire" as const, rule: "", notes: "" }, { id: "q", code: "quantite", label: "quantité", type: "N", size: "", format: "", description: "", nature: "elementaire" as const, rule: "", notes: "" }];
    const mpd = mldToMpd(tables, dict);
    expect(mpd.find((t) => t.name === "commande")?.columns.find((c) => c.name === "date")?.type).toBe("DATE");
    expect(mpdIssues(mpd).filter((i) => i.level === "error")).toEqual([]);
    const sql = mpdToSql(mpd);
    expect(sql.indexOf("CREATE TABLE client")).toBeLessThan(sql.indexOf("CREATE TABLE commande"));
    expect(sql.indexOf("CREATE TABLE commande")).toBeLessThan(sql.indexOf("CREATE TABLE contenir"));
    expect(sql).toContain("PRIMARY KEY (numcommande, refproduit)");
    expect(sql).toContain("FOREIGN KEY (idclient) REFERENCES client(idclient)");
  });
  it("compare le MLD de l'étudiant à celui que donnent les règles", () => {
    const wrong = tables.filter((t) => t.name !== "contenir").map((t) => (t.name === "commande" ? { ...t, columns: t.columns.map((c) => ({ ...c, fkTable: "", fkColumn: "" })) } : t));
    const m = mldIssues(wrong, MCD).map((i) => i.message).join("|");
    expect(m).toContain("Table attendue absente : « contenir »");
    expect(m).toContain("devrait être une clé étrangère");
    expect(mldIssues(tables, MCD)).toEqual([]);
  });
  it("détecte un MPD incohérent (table inexistante, type absent, pas de clé)", () => {
    const mpd = [{ id: "t", name: "a", columns: [{ id: "c", name: "x", pk: false, fkTable: "zzz", fkColumn: "y", type: "", size: "", notNull: false, unique: false }] }];
    const m = mpdIssues(mpd).map((i) => i.message).join("|");
    expect(m).toContain("pas de clé primaire");
    expect(m).toContain("n'a pas de type");
    expect(m).toContain("table inexistante");
  });
});

describe("correction face à une référence", () => {
  const ref = meriseReferenceSchema.parse({
    deliverables: ["mcd"],
    entities: [{ name: "Client", attributes: ["nom"], identifier: ["idClient"] }, { name: "Commande", attributes: ["date"], identifier: ["numCommande"] }, { name: "Produit", attributes: ["libelle"], identifier: ["refProduit"] }],
    associations: [{ name: "Passer", links: [{ entity: "Client", card: "0,N" }, { entity: "Commande", card: "1,1" }] }, { name: "Contenir", links: [{ entity: "Commande", card: "1,N" }, { entity: "Produit", card: "0,N" }] }],
  });
  const work = (mcd: Mcd) => ({ ...emptyMerise(), mcd });
  it("donne la note maximale à une solution exacte, même nommée ou ordonnée autrement", () => {
    const g = gradeMerise(work({ entities: MCD.entities.map((e) => ({ ...e, name: e.name.toLowerCase() + "s" })).reverse(), associations: MCD.associations.map((a) => ({ ...a, name: "autre nom" })) }), ref);
    expect(g.ratio).toBeCloseTo(1, 5);
  });
  it("retire des points pour entité, identifiant, association et cardinalité manquants, et explique", () => {
    const partial: Mcd = {
      entities: [ent("Client", [attr("nom")]), ent("Commande", [attr("numCommande", true), attr("date")])],
      associations: [assoc("Passer", [link("Client", "0,N"), link("Commande", "0,N")])],
    };
    const g = gradeMerise(work(partial), ref);
    expect(g.ratio).toBeGreaterThan(0.2);
    expect(g.ratio).toBeLessThan(0.7);
    const bad = g.checks.filter((c) => !c.ok).map((c) => `${c.label} ${c.detail ?? ""}`).join("|");
    expect(bad).toContain("Entité « Produit »");
    expect(bad).toContain("Identifiant « idClient »");
    expect(bad).toContain("0,N au lieu de 1,1");
  });
  it("note zéro pour un atelier vide", () => {
    expect(gradeMerise(emptyMerise(), ref).ratio).toBe(0);
    expect(isMeriseEmpty(emptyMerise())).toBe(true);
  });
  it("lit sans erreur une production abîmée", () => {
    expect(readMerise("n'importe quoi")).toEqual(emptyMerise());
    expect(readMerise({ mcd: { entities: [{ id: "a", name: "A" }] } }).mcd.entities[0].attributes).toEqual([]);
    expect(meriseIssues(emptyMerise())).toEqual([]);
  });
});
