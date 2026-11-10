// Proxy : lien d'administration distinct (ADMIN_HOST) et transmission de la route aux mesures d'API.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const call = async (host: string | undefined, url: string, adminHost: string | undefined) => {
  vi.resetModules();
  if (adminHost === undefined) delete process.env.ADMIN_HOST;
  else process.env.ADMIN_HOST = adminHost;
  const { proxy } = await import("./proxy");
  const path = new URL(url, "https://x.test");
  return proxy(new NextRequest(path, { headers: host ? { host } : {}, method: "POST" }));
};

afterEach(() => {
  delete process.env.ADMIN_HOST;
});

describe("domaine d'administration distinct", () => {
  const ADMIN = "admin.niala.test";

  it("ne sert le back-office que sur le domaine d'administration", async () => {
    expect((await call("niala.test", "/admin", ADMIN)).status).toBe(404);
    expect((await call("niala.test", "/admin/utilisateurs", ADMIN)).status).toBe(404);
    expect((await call("niala.test", "/api/admin/users", ADMIN)).status).toBe(404);
    expect((await call("niala.test", "/matieres", ADMIN)).status).toBe(200);
    const home = await call(ADMIN, "/admin", ADMIN);
    expect(home.status).toBe(200);
    expect((await call(ADMIN, "/api/admin/auth/login", ADMIN)).status).toBe(200);
  });

  it("n'expose pas l'espace étudiant sur le domaine d'administration, hors ressources partagées", async () => {
    expect((await call(ADMIN, "/matieres", ADMIN)).status).toBe(404);
    expect((await call(ADMIN, "/api/subjects", ADMIN)).status).toBe(404);
    expect((await call(ADMIN, "/login", ADMIN)).status).toBe(404);
    expect((await call(ADMIN, "/auth/callback", ADMIN)).status).toBe(200); // retour Google
    expect((await call(ADMIN, "/_next/static/chunk.js", ADMIN)).status).toBe(200);
    const root = await call(ADMIN, "/", ADMIN);
    expect(root.status).toBe(307);
    expect(root.headers.get("location")).toContain("/admin");
  });

  it("tient compte du port et de la casse du nom d'hôte", async () => {
    expect((await call("ADMIN.niala.test:3000", "/matieres", ADMIN)).status).toBe(404);
    expect((await call("niala.test:3000", "/admin", ADMIN)).status).toBe(404);
  });

  it("laisse tout accessible sous /admin quand aucun domaine n'est configuré (développement)", async () => {
    expect((await call("localhost:3000", "/admin", undefined)).status).toBe(200);
    expect((await call("localhost:3000", "/matieres", undefined)).status).toBe(200);
  });
});

describe("mesure des requêtes d'API", () => {
  it("transmet la route et la méthode aux routes d'API, et seulement à elles", async () => {
    const api = await call("niala.test", "/api/exercises/abc", undefined);
    expect(api.headers.get("x-middleware-request-x-niala-path")).toBe("/api/exercises/abc");
    expect(api.headers.get("x-middleware-request-x-niala-method")).toBe("POST");
    const page = await call("niala.test", "/exercices", undefined);
    expect(page.headers.get("x-middleware-request-x-niala-path")).toBeNull();
  });
});
