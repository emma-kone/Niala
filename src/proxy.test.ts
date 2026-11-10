// Proxy : lien d'administration distinct (ADMIN_HOST) et transmission de la route aux mesures d'API.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const call = async (host: string | undefined, url: string, adminHost: string | undefined, extra: { cookie?: string } = {}) => {
  vi.resetModules();
  if (adminHost === undefined) delete process.env.ADMIN_HOST;
  else process.env.ADMIN_HOST = adminHost;
  const { proxy } = await import("./proxy");
  const path = new URL(url, "https://x.test");
  return proxy(new NextRequest(path, { headers: { ...(host ? { host } : {}), ...(extra.cookie ? { cookie: extra.cookie } : {}) }, method: "POST" }));
};

afterEach(() => {
  delete process.env.ADMIN_HOST;
  delete process.env.ADMIN_PATH;
  delete process.env.ADMIN_ACCESS_HASH;
  vi.unstubAllEnvs();
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

describe("adresse secrète du back-office (ADMIN_PATH)", () => {
  const SLUG = "k3J9xQ2mZp7LwR5tYb8NcV4hDs6FgA1e";
  /** Refus = réécriture vers une page inexistante (404 ordinaire du site, sans indice). */
  const denied = (r: Response) => r.headers.get("x-middleware-rewrite")?.includes("__niala_absent__") === true;

  it("n'ouvre /admin et /api/admin qu'après passage par l'adresse secrète", async () => {
    process.env.ADMIN_PATH = SLUG;
    expect(denied(await call("niala.test", "/admin", undefined))).toBe(true);
    expect(denied(await call("niala.test", "/admin/login", undefined))).toBe(true);
    expect(denied(await call("niala.test", "/api/admin/auth/login", undefined))).toBe(true);
    const entry = await call("niala.test", `/${SLUG}`, undefined);
    expect(entry.status).toBe(307);
    expect(new URL(entry.headers.get("location")!).pathname).toBe("/admin");
    const cookie = entry.headers.get("set-cookie")!;
    expect(cookie).toContain("niala_gate=");
    expect(cookie.toLowerCase()).toContain("httponly");
    const pass = cookie.split(";")[0];
    expect((await call("niala.test", "/admin", undefined, { cookie: pass })).status).toBe(200);
    expect((await call("niala.test", "/api/admin/users", undefined, { cookie: pass })).status).toBe(200);
  });

  it("fonctionne avec une adresse lisible", async () => {
    process.env.ADMIN_PATH = "nialaspace-admin";
    const entry = await call("niala.test", "/nialaspace-admin", undefined);
    expect(entry.status).toBe(307);
    expect(denied(await call("niala.test", "/admin", undefined))).toBe(true);
  });

  it("redirige /<secret>/login vers /admin/login et refuse un faux cookie ou une variante de l'adresse", async () => {
    process.env.ADMIN_PATH = SLUG;
    const login = await call("niala.test", `/${SLUG}/login`, undefined);
    expect(new URL(login.headers.get("location")!).pathname).toBe("/admin/login");
    expect(denied(await call("niala.test", "/admin", undefined, { cookie: "niala_gate=nimporte-quoi" }))).toBe(true);
    expect(denied(await call("niala.test", "/admin", undefined, { cookie: "niala_gate=" }))).toBe(true);
    for (const guess of ["/administrator", "/admin-login", "/backoffice", `/${SLUG.slice(0, -1)}`, `/${SLUG}x`, "/dashboard", "/_admin"]) {
      const r = await call("niala.test", guess, undefined);
      expect(r.status).not.toBe(307);
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("accepte une adresse lisible comme nialaspace-admin, refuse les valeurs trop courtes ou réservées et ferme le back-office en production sans ADMIN_PATH", async () => {
    for (const bad of ["admin", "court", "reglages", "a b c d e f g h", "../admin-x"]) {
      process.env.ADMIN_PATH = bad;
      expect((await call("niala.test", "/admin", undefined)).headers.get("x-middleware-rewrite")).toBeNull(); // hors production, valeur invalide ignorée
    }
    expect((await call("niala.test", "/admin", undefined)).headers.get("set-cookie")).toBeNull();
    vi.stubEnv("NODE_ENV", "production");
    expect(denied(await call("niala.test", "/admin", undefined))).toBe(true);
    expect(denied(await call("niala.test", "/api/admin/users", undefined))).toBe(true);
    expect((await call("niala.test", "/matieres", undefined)).status).toBe(200);
  });
});

describe("code d'accès devant la connexion (ADMIN_ACCESS_HASH)", () => {
  const SLUG = "nialaspace-admin";
  const HASH = "a".repeat(32) + "." + "b".repeat(128);
  const denied = (r: Response) => r.headers.get("x-middleware-rewrite")?.includes("__niala_absent__") === true;

  it("affiche la page du code (sans changer d'adresse) tant que le cookie de passage manque", async () => {
    process.env.ADMIN_PATH = SLUG;
    process.env.ADMIN_ACCESS_HASH = HASH;
    const entry = await call("niala.test", `/${SLUG}`, undefined);
    expect(entry.status).toBe(200);
    expect(entry.headers.get("x-middleware-rewrite")).toContain("/zz-gate");
    expect(entry.headers.get("set-cookie")).toBeNull();
    const sub = await call("niala.test", `/${SLUG}/login`, undefined);
    expect(sub.headers.get("x-middleware-rewrite")).toContain("/zz-gate");
    expect(denied(await call("niala.test", "/admin/login", undefined))).toBe(true);
  });

  it("n'expose jamais la page du code ni ses actions en accès direct", async () => {
    process.env.ADMIN_PATH = SLUG;
    process.env.ADMIN_ACCESS_HASH = HASH;
    expect(denied(await call("niala.test", "/zz-gate", undefined))).toBe(true);
    expect(denied(await call("niala.test", "/zz-gate/x", undefined))).toBe(true);
  });

  it("laisse passer un visiteur muni d'un cookie valide, et seulement celui-là", async () => {
    process.env.ADMIN_PATH = SLUG;
    process.env.ADMIN_ACCESS_HASH = HASH;
    vi.resetModules();
    const { gateToken } = await import("@/server/admin/gate");
    const good = `niala_gate=${gateToken(SLUG)}`;
    const entry = await call("niala.test", `/${SLUG}`, undefined, { cookie: good });
    expect(entry.status).toBe(307);
    expect(new URL(entry.headers.get("location")!).pathname).toBe("/admin");
    expect((await call("niala.test", "/admin/login", undefined, { cookie: good })).headers.get("x-middleware-rewrite")).toBeNull();
    expect(denied(await call("niala.test", "/admin/login", undefined, { cookie: "niala_gate=faux" }))).toBe(true);
  });
});
