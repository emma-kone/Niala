// Les erreurs de base de données reconnues ont une réponse explicite (4xx/503) au lieu d'une erreur 500 anonyme.
import { describe, expect, it } from "vitest";
import { databaseHttpError } from "./api-helpers";

class PrismaClientKnownRequestError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
class PrismaClientInitializationError extends Error {}
class PrismaClientValidationError extends Error {}

describe("databaseHttpError", () => {
  it("transaction expirée, pool saturé, base injoignable : 503 « réessayez », rien n'a été enregistré", () => {
    for (const code of ["P2028", "P2024", "P1001", "P2034"]) {
      const r = databaseHttpError(new PrismaClientKnownRequestError(code));
      expect(r?.status).toBe(503);
      expect(r?.message).toContain("Réessayez");
    }
    expect(databaseHttpError(new PrismaClientInitializationError("x"))?.status).toBe(503);
  });

  it("élément disparu, doublon, lien rompu : 404 ou 409 explicites", () => {
    expect(databaseHttpError(new PrismaClientKnownRequestError("P2025"))?.status).toBe(404);
    expect(databaseHttpError(new PrismaClientKnownRequestError("P2002"))?.status).toBe(409);
    expect(databaseHttpError(new PrismaClientKnownRequestError("P2003"))?.status).toBe(409);
  });

  it("une vraie anomalie de code (validation Prisma, erreur inconnue) reste une erreur 500", () => {
    expect(databaseHttpError(new PrismaClientValidationError("x"))).toBeNull();
    expect(databaseHttpError(new PrismaClientKnownRequestError("P9999"))).toBeNull();
    expect(databaseHttpError("x")).toBeNull();
  });
});
