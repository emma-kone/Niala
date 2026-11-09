import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { createLinkToken, hashPassword, verifyLinkToken, verifyPassword } from "@/lib/auth";
import { ownedBy, assertFound } from "@/lib/ownership";

describe("mots de passe", () => {
  it("vérifie un mot de passe correct et refuse un incorrect", () => {
    const h = hashPassword("un-mot-de-passe-solide");
    expect(verifyPassword("un-mot-de-passe-solide", h)).toBe(true);
    expect(verifyPassword("autre", h)).toBe(false);
  });
  it("refuse un hachage mal formé", () => {
    expect(verifyPassword("x", "n-importe-quoi")).toBe(false);
  });
});

describe("ownership", () => {
  it("exige un userId", () => {
    expect(() => ownedBy("")).toThrow();
    expect(ownedBy("u1")).toEqual({ userId: "u1" });
  });
  it("assertFound lève un 404", () => {
    expect(() => assertFound(null, "Document")).toThrowError("Document introuvable.");
  });
});

describe("jeton de liaison Google", () => {
  const link = { sub: "g-1", email: "ada@example.fr", name: "Ada" };

  it("restitue le profil tant que le jeton est valide", () => {
    expect(verifyLinkToken(createLinkToken(link))).toEqual(link);
  });
  it("expire après 10 minutes", () => {
    const now = Date.now();
    expect(verifyLinkToken(createLinkToken(link, now), now + 9 * 60_000)).toEqual(link);
    expect(verifyLinkToken(createLinkToken(link, now), now + 11 * 60_000)).toBeNull();
  });
  it("refuse un jeton falsifié ou mal formé", () => {
    const [payload, sig] = createLinkToken(link).split(".");
    const forged = Buffer.from(JSON.stringify({ ...link, email: "victime@example.fr", exp: Date.now() + 60_000 })).toString("base64url");
    expect(verifyLinkToken(`${forged}.${sig}`)).toBeNull();
    expect(verifyLinkToken(`${payload}.x`)).toBeNull();
    expect(verifyLinkToken("")).toBeNull();
    expect(verifyLinkToken(`${payload}.${sig}.extra`)).toBeNull();
  });
  it("n'accepte pas un jeton de session à la place", () => {
    expect(verifyLinkToken("user1.9999999999999.signature")).toBeNull();
  });
});
