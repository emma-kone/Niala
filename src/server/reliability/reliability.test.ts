// Scénarios de fiabilité : règles réelles, avec un vérificateur IA simulé. Les cas piégés sont volontaires.
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyVerification, needsVerification, verifyAnswer, type VerifiableSource, type VerificationReport } from "./claims";
import { evaluateClaim, type ClaimFacts, type EvaluatedEvidence, type EvaluatedSource } from "./confidence";
import { independentGroups, registrableDomain } from "./cross-check";
import { assessSource, inferPublication } from "./sources";

const generate = vi.hoisted(() => ({ next: (() => ({ claims: [] })) as () => unknown, calls: 0 }));
vi.mock("@/server/ai/structured", () => ({
  generateStructured: async (req: { schema: { parse: (v: unknown) => unknown } }) => {
    generate.calls++;
    return { data: req.schema.parse(generate.next()), model: "fake" };
  },
}));

const NOW = new Date("2026-11-08T12:00:00Z");
const fact = (over: Partial<ClaimFacts> = {}): ClaimFacts => ({ type: "fait", domain: "general", timeSensitive: false, ...over });

function web(n: number, url: string, text = `Contenu propre à la source numéro ${n} avec des mots différents ${"x".repeat(n)}`, year: number | null = null): VerifiableSource {
  const a = assessSource({ url });
  return { n, kind: "web", title: `Source ${n}`, url, host: new URL(url).hostname.replace(/^www\./, ""), text, level: a.level, sourceKind: a.kind, year };
}
const doc = (n: number, text: string): VerifiableSource => ({ n, kind: "document", title: "Mon cours", text });
const proof = (source: EvaluatedSource, stance: "soutient" | "contredit" = "soutient", direct = true): EvaluatedEvidence => ({ source, stance, direct });

afterEach(() => {
  generate.calls = 0;
  generate.next = () => ({ claims: [] });
});

describe("classification page par page", () => {
  it.each([
    ["https://developer.mozilla.org/fr/docs/Web", 1, "documentation"],
    ["https://docs.python.org/3/library/", 1, "documentation"],
    ["https://www.legifrance.gouv.fr/loda/id/X", 1, "loi"],
    ["https://eur-lex.europa.eu/legal-content/FR", 1, "loi"],
    ["https://pubmed.ncbi.nlm.nih.gov/123/", 1, "recherche"],
    ["https://www.who.int/fr/news-room", 1, "institution"],
    ["https://www.insee.fr/fr/statistiques", 1, "institution"],
    ["https://www.univ-lyon1.fr/cours", 1, "universite"],
    ["https://fr.wikipedia.org/wiki/Android", 2, "reference"],
    ["https://arxiv.org/abs/2401.00001", 2, "reference"],
    ["https://blogs.oracle.com/java/post", 2, "blog"],
    ["https://stackoverflow.com/questions/1", 3, "forum"],
    ["https://www.reddit.com/r/python", 3, "forum"],
    ["https://github.com/a/b/discussions/1", 3, "forum"],
    ["https://discuss.kotlinlang.org/t/1", 3, "forum"],
    ["https://users.rust-lang.org/t/1", 3, "forum"],
    ["https://answers.microsoft.com/fr-fr/x", 3, "forum"],
    ["https://openclassrooms.com/forum/sujet/x", 3, "forum"],
    ["https://stuff.mit.edu/~etudiant/notes", 4, "blog"],
    ["https://medium.com/@x/article", 4, "blog"],
    ["https://x.com/quelqu_un/status/1", 4, "social"],
    ["https://monblog.example.com/android", 4, "inconnu"],
    ["https://developer.android.com.evil.io/doc", 4, "inconnu"],
  ])("%s → niveau %i", (url, level, kind) => {
    expect(assessSource({ url })).toMatchObject({ level, kind });
  });

  it("une tribune sur un média reconnu reste une opinion", () => {
    expect(assessSource({ url: "https://www.lemonde.fr/idees/article/x", title: "Tribune : il faut interdire X" })).toMatchObject({ level: 3, kind: "opinion" });
  });

  it("ne devine jamais une date", () => {
    expect(inferPublication("https://exemple.org/page", "Aucune date ici.", NOW).year).toBeNull();
    expect(inferPublication("https://exemple.org/2019/03/article", "", NOW).year).toBe(2019);
    expect(inferPublication("https://exemple.org/p", "Dernière mise à jour : 12 mars 2021.", NOW).year).toBe(2021);
  });
});

describe("indépendance des sources", () => {
  const copie = "La fonction retourne toujours une liste triée par ordre croissant selon la clé fournie en paramètre par appelant";
  it("(5) des sites qui recopient le même texte ne comptent que pour une confirmation", () => {
    expect(independentGroups([{ n: 1, host: "a.org", text: copie }, { n: 2, host: "b.net", text: copie }, { n: 3, host: "c.fr", text: `Reprise : ${copie}` }])).toHaveLength(1);
  });
  it("deux pages du même organisme ne font qu'une source", () => {
    expect(registrableDomain("service-public.gouv.fr")).toBe("service-public.gouv.fr");
    expect(independentGroups([{ n: 1, host: "docs.python.org", text: "un texte tout à fait différent ici présent" }, { n: 2, host: "wiki.python.org", text: "autre contenu sans le moindre rapport visible" }])).toHaveLength(1);
  });
  it("(5) sur un sujet sensible, des copies n'élèvent pas la confiance, de vraies sources indépendantes oui", () => {
    const a = web(1, "https://www.univ-lyon1.fr/a", copie);
    const copy = web(2, "https://www.univ-lille.fr/b", copie);
    const other = web(3, "https://www.univ-rennes.fr/c", "Une formulation entièrement distincte qui établit le même résultat avec ses propres mots et données");
    expect(evaluateClaim(fact({ domain: "sante" }), [proof(a), proof(copy)], NOW)).toMatchObject({ confidence: "moderee" });
    expect(evaluateClaim(fact({ domain: "sante" }), [proof(a), proof(other)], NOW).confidence).toBe("elevee");
  });
});

describe("niveau de confiance", () => {
  const official = web(1, "https://docs.python.org/3/x");
  const forum = web(2, "https://stackoverflow.com/questions/2");
  const blog = web(3, "https://monblog.example.com/x");
  const wiki = web(4, "https://fr.wikipedia.org/wiki/X");
  const mozilla = web(5, "https://developer.mozilla.org/x");

  it("(1) confirmée par la documentation officielle : confiance élevée, sans avertissement", () => {
    expect(evaluateClaim(fact(), [proof(official)], NOW)).toMatchObject({ confidence: "elevee", annotation: null, basis: "web" });
  });
  it("(2) uniquement un forum : signalé comme tel", () => {
    const r = evaluateClaim(fact(), [proof(forum)], NOW);
    expect(r.confidence).toBe("faible");
    expect(r.annotation).toContain("forum");
  });
  it("(3) un forum réputé contredit par la documentation n'est pas retenu", () => {
    const r = evaluateClaim(fact(), [proof(forum), proof(official, "contredit")], NOW);
    expect(r.confidence).toBe("non_verifiee");
    expect(r.annotation).toContain("contredite");
  });
  it("(3) de nombreux forums concordants restent une confiance faible", () => {
    expect(evaluateClaim(fact(), [proof(forum), proof(web(6, "https://www.reddit.com/r/a")), proof(web(7, "https://discuss.kotlinlang.org/t/9"))], NOW).confidence).toBe("faible");
  });
  it("(4) une information évolutive trop ancienne est signalée", () => {
    const r = evaluateClaim(fact({ timeSensitive: true, domain: "programmation" }), [proof({ ...official, year: 2018 })], NOW);
    expect(r.confidence).toBe("moderee");
    expect(r.annotation).toContain("obsolète");
  });
  it("(4) un principe fondamental ancien reste valable", () => {
    expect(evaluateClaim(fact({ timeSensitive: false }), [proof({ ...official, year: 1998 })], NOW).confidence).toBe("elevee");
  });
  it("(6) des sources crédibles contradictoires déclenchent un avertissement", () => {
    const r = evaluateClaim(fact(), [proof(official), proof(mozilla, "contredit")], NOW);
    expect(r.confidence).toBe("contradictoire");
    expect(r.annotation).toContain("contradictoires");
  });
  it("(7) une affirmation sans preuve n'est jamais présentée comme un fait", () => {
    const r = evaluateClaim(fact(), [], NOW);
    expect(r).toMatchObject({ confidence: "non_verifiee", basis: "aucune" });
    expect(r.annotation).toBeTruthy();
  });
  it("une source inconnue seule ne suffit pas", () => {
    expect(evaluateClaim(fact(), [proof(blog)], NOW).confidence).toBe("non_verifiee");
  });
  it("une source secondaire donne une confiance modérée, sans alourdir le texte", () => {
    expect(evaluateClaim(fact(), [proof(wiki)], NOW)).toMatchObject({ confidence: "moderee", annotation: null });
  });
  it("une déduction n'est pas un fait directement établi", () => {
    const r = evaluateClaim(fact(), [proof(official, "soutient", false)], NOW);
    expect(r.confidence).toBe("moderee");
    expect(r.annotation).toContain("déduction");
  });
  it("une hypothèse reste une hypothèse, même bien sourcée", () => {
    const r = evaluateClaim(fact({ type: "hypothese" }), [proof(official)], NOW);
    expect(r.confidence).toBe("moderee");
    expect(r.annotation).toContain("hypothèse");
  });
  it("en droit, un texte officiel suffit ; une seule université non", () => {
    expect(evaluateClaim(fact({ domain: "droit" }), [proof(web(8, "https://www.legifrance.gouv.fr/x"))], NOW).confidence).toBe("elevee");
    expect(evaluateClaim(fact({ domain: "droit" }), [proof(web(9, "https://www.univ-lyon1.fr/x"))], NOW).confidence).toBe("moderee");
  });
  it("(9) une information du document est attribuée au document, pas présentée comme vérifiée", () => {
    expect(evaluateClaim(fact(), [proof(doc(1, "Le cours dit ceci."))], NOW)).toMatchObject({ basis: "document", confidence: "non_verifiee", annotation: null });
  });
  it("(10) une erreur de cours est signalée quand une preuve fiable la contredit", () => {
    const r = evaluateClaim(fact(), [proof(doc(1, "Le cours dit ceci.")), proof(official, "contredit")], NOW);
    expect(r).toMatchObject({ confidence: "contradictoire", courseConflict: true });
    expect(r.annotation).toContain("Votre cours");
  });
});

describe("contrôle des preuves", () => {
  const texte = "La méthode onResume est appelée juste avant que l'activité commence à interagir avec l'utilisateur.";
  const sources = [web(1, "https://developer.android.com/guide", texte)];
  const base = { userId: "u", question: "Q", citedDocument: false, webStatus: "utilisee" as const, now: NOW };

  it("(1) une preuve recopiée de la source est acceptée", async () => {
    const answer = "onResume est appelée avant l'interaction avec l'utilisateur [1].";
    generate.next = () => ({ claims: [{ text: "onResume est appelée avant l'interaction avec l'utilisateur", preuves: [{ n: 1, position: "soutient", citation: "appelée juste avant que l'activité commence à interagir", directe: true }] }] });
    const r = await verifyAnswer({ ...base, answer, sources });
    expect(r.claims[0].confidence).toBe("elevee");
    expect(applyVerification(answer, r)).toBe(answer);
  });

  it("(8) une citation inventée est rejetée, et l'affirmation n'est pas validée", async () => {
    const answer = "onResume libère la mémoire de l'application [1].";
    generate.next = () => ({ claims: [{ text: "onResume libère la mémoire de l'application", preuves: [{ n: 1, position: "soutient", citation: "onResume libère toute la mémoire de l'application immédiatement", directe: true }] }] });
    const r = await verifyAnswer({ ...base, answer, sources });
    expect(r.rejectedCitations).toBe(1);
    expect(r.claims[0].confidence).toBe("non_verifiee");
    const out = applyVerification(answer, r);
    expect(out).not.toContain("[1]");
    expect(out).toContain("⚠️");
  });

  it("(8) un numéro de source inconnu est rejeté", async () => {
    generate.next = () => ({ claims: [{ text: "onResume libère la mémoire", preuves: [{ n: 42, position: "soutient", citation: "appelée juste avant que l'activité commence", directe: true }] }] });
    const r = await verifyAnswer({ ...base, answer: "onResume libère la mémoire.", sources });
    expect(r.claims[0].evidence).toEqual([]);
    expect(r.rejectedCitations).toBe(1);
  });

  it("une source sur le même sujet qui ne confirme pas perd sa citation", async () => {
    const answer = "La Terre est plate [1].";
    generate.next = () => ({ claims: [{ text: "La Terre est plate", preuves: [{ n: 1, position: "sans_rapport", citation: "", directe: true }] }] });
    const out = applyVerification(answer, await verifyAnswer({ ...base, answer, sources }));
    expect(out).not.toContain("[1]");
    expect(out).toContain("ne permet de confirmer");
  });

  it("une affirmation reformulée par le vérificateur est ignorée", async () => {
    generate.next = () => ({ claims: [{ text: "Une phrase qui n'apparaît nulle part dans la réponse", preuves: [] }] });
    expect((await verifyAnswer({ ...base, answer: "Texte réel de la réponse, version 3.", sources })).claims).toEqual([]);
  });

  it("le recoupement ajoute une source indépendante sur un point sensible", async () => {
    const answer = "Ce médicament se prend deux fois par jour [1].";
    const first = web(1, "https://www.univ-lyon1.fr/x", "Ce médicament se prend deux fois par jour selon les études disponibles.");
    const second = web(2, "https://www.bmj.com/y", "Les recommandations indiquent une posologie de deux prises quotidiennes pour ce traitement.");
    let step = 0;
    generate.next = () => (step++ === 0
      ? { claims: [{ text: "Ce médicament se prend deux fois par jour", domain: "sante", preuves: [{ n: 1, position: "soutient", citation: "se prend deux fois par jour selon les études", directe: true }] }] }
      : { claims: [{ text: "Ce médicament se prend deux fois par jour", domain: "sante", preuves: [{ n: 2, position: "soutient", citation: "une posologie de deux prises quotidiennes", directe: true }] }] });
    const r = await verifyAnswer({ ...base, answer, sources: [first], search: async () => [second] });
    expect(generate.calls).toBe(2);
    expect(r.claims[0].evidence.map((e) => e.n)).toEqual([1, 2]);
    expect(r.claims[0].confidence).toBe("elevee");
  });
});

describe("honnêteté sur ce qui a été vérifié", () => {
  it("(12) sans accès web, aucune vérification n'est revendiquée", async () => {
    generate.next = () => ({ claims: [{ text: "Python 3.13 est sorti en 2024", preuves: [] }] });
    const r = await verifyAnswer({ userId: "u", question: "Q", answer: "Python 3.13 est sorti en 2024.", sources: [], citedDocument: false, webStatus: "indisponible", now: NOW });
    expect(r.claims[0].confidence).toBe("non_verifiee");
    expect(r.summary.elevee).toBe(0);
    expect(r.limits.join(" ")).toContain("rien n'a été vérifié en ligne");
  });

  it("(12) si le vérificateur tombe en panne, la réponse est marquée non contrôlée", async () => {
    generate.next = () => {
      throw new Error("quota");
    };
    const r = await verifyAnswer({ userId: "u", question: "Q", answer: "Version 3 sortie en 2024.", sources: [], citedDocument: false, webStatus: "non_utilisee", now: NOW });
    expect(r.status).toBe("echec");
    expect(r.limits.join(" ")).toContain("n'a pas été contrôlée");
  });

  it("n'appelle pas le vérificateur pour une explication tirée du cours", async () => {
    const r = await verifyAnswer({ userId: "u", question: "Q", answer: "Selon ton document, une pile est LIFO depuis 1960 [1].", sources: [doc(1, "Une pile est LIFO.")], citedDocument: true, webStatus: "non_utilisee", now: NOW });
    expect(r.status).toBe("ignoree");
    expect(generate.calls).toBe(0);
  });

  it("déclenche la vérification sur un fait précis sans source, pas sur une explication générale", () => {
    expect(needsVerification("La loi 78 date de 1978.", [], false)).toBe(true);
    expect(needsVerification("Une boucle répète des instructions.", [], false)).toBe(false);
    expect(needsVerification("Rien de précis.", [{ kind: "web" }], false)).toBe(true);
  });

  it("respecte l'heure limite : pas d'appel tardif", async () => {
    const r = await verifyAnswer({ userId: "u", question: "Q", answer: "Version 3 en 2024.", sources: [], citedDocument: false, webStatus: "non_utilisee", now: NOW, deadlineAt: Date.now() - 1 });
    expect(r.status).toBe("echec");
    expect(generate.calls).toBe(0);
  });
});

describe("lisibilité", () => {
  const claim = (text: string, annotation: string | null) => ({ text, type: "fait" as const, domain: "general" as const, confidence: annotation ? ("non_verifiee" as const) : ("elevee" as const), basis: "web" as const, reason: "r", limits: [], annotation, courseConflict: false, evidence: [], rejected: [] });
  const report = (claims: ReturnType<typeof claim>[]): VerificationReport => ({ status: "effectuee", webStatus: "utilisee", claims, summary: { elevee: 0, moderee: 0, faible: 0, non_verifiee: 0, contradictoire: 0, document: 0 }, rejectedCitations: 0, limits: [], checkedAt: "" });

  it("(11) l'avertissement est placé à côté de la bonne affirmation, le reste est intact", () => {
    const out = applyVerification("Le premier point est établi [1]. Le second point est douteux [2]. Fin.", report([claim("Le premier point est établi", null), claim("Le second point est douteux", "À vérifier.")]));
    expect(out).toBe("Le premier point est établi [1]. Le second point est douteux [2]. *(⚠️ À vérifier.)* Fin.");
  });
  it("(11) le nombre d'avertissements dans le texte est borné", () => {
    const parts = Array.from({ length: 9 }, (_, i) => `Affirmation numero ${i} du texte`);
    const out = applyVerification(parts.join(". ") + ".", report(parts.map((p, i) => claim(p, `Note ${i}.`))));
    expect(out.match(/⚠️/g)).toHaveLength(6);
  });
  it("(11) aucun doublon si l'IA a déjà averti, rien dans un bloc de code", () => {
    expect(applyVerification("⚠️ Information non officielle : le point X", report([claim("le point X", "Note.")]))).not.toContain("Note.");
    const code = "```\nle point X\n```";
    expect(applyVerification(code, report([claim("le point X", "Note.")]))).toBe(code);
  });
});
