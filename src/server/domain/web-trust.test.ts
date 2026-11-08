import { describe, expect, it } from "vitest";
import { assessReliability, hostOf, trustTier } from "./web-trust";

describe("niveau de fiabilité d'une recherche", () => {
  it("« aucune » sans résultat", () => {
    expect(assessReliability([])).toEqual({ level: "aucune", recognized: 0, independent: 0 });
  });
  it("« verifiee » dès qu'une source reconnue est présente", () => {
    const r = assessReliability([{ host: "kotlinlang.org", tier: "reconnue" }, { host: "blog.example.com", tier: "a_verifier" }]);
    expect(r).toEqual({ level: "verifiee", recognized: 1, independent: 2 });
  });
  it("« non_verifiee » quand toutes les sources sont à vérifier, même nombreuses", () => {
    const r = assessReliability([{ host: "a.com", tier: "a_verifier" }, { host: "b.com", tier: "a_verifier" }, { host: "a.com", tier: "a_verifier" }]);
    expect(r).toEqual({ level: "non_verifiee", recognized: 0, independent: 2 });
  });
});

describe("fiabilité des sources web", () => {
  it("reconnaît documentation officielle, universités et administrations", () => {
    for (const u of ["https://developer.android.com/guide/components/activities/activity-lifecycle", "https://fr.wikipedia.org/wiki/Android", "https://www.mit.edu/x", "https://cs.stanford.edu/", "https://www.univ-lyon1.fr/", "https://www.education.gouv.fr/", "https://docs.python.org/3/"])
      expect(trustTier(hostOf(u))).toBe("reconnue");
  });
  it("marque le reste « à vérifier », y compris les domaines qui imitent un domaine fiable", () => {
    for (const u of ["https://monblog.example.com/android", "https://developer.android.com.evil.io/", "https://notmit.edu.evil.com/", "not a url"])
      expect(trustTier(hostOf(u))).toBe("a_verifier");
  });
});
