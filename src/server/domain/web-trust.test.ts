import { describe, expect, it } from "vitest";
import { hostOf, trustTier } from "./web-trust";

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
