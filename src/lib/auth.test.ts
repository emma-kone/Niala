import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { hashPassword, verifyPassword } from "@/lib/auth";
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

describe("limitation de débit", () => {
  it("compte chaque clé séparément : saturer une clé ne bloque pas les autres", async () => {
    const { rateLimit } = await import("@/lib/auth");
    for (let i = 0; i < 10; i++) expect(rateLimit("t:login:email:a@x.fr", 10, 60_000)).toBe(true);
    expect(rateLimit("t:login:email:a@x.fr", 10, 60_000)).toBe(false);
    expect(rateLimit("t:login:email:b@x.fr", 10, 60_000)).toBe(true);
  });
});
