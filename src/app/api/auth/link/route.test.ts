// Route de liaison Google : cookie en attente, limitation de débit et ouverture de session, la base étant simulée.
import { beforeEach, describe, expect, it, vi } from "vitest";

const getPendingLink = vi.fn();
const setSessionCookie = vi.fn(async () => undefined);
const clearLinkCookie = vi.fn(async () => undefined);
const linkGoogleAccount = vi.fn();

vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), getPendingLink, setSessionCookie, clearLinkCookie }));
vi.mock("@/server/services/accounts", async (original) => ({ ...(await original<typeof import("@/server/services/accounts")>()), linkGoogleAccount }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));

const { POST, DELETE } = await import("./route");
const { LinkError } = await import("@/server/services/accounts");

let n = 0;
const pending = () => ({ sub: "g-1", email: `ada${n++}@example.fr`, name: "Ada" });
const post = (password: unknown) => POST(new Request("https://niala.test/api/auth/link", { method: "POST", body: JSON.stringify({ password }) }));

beforeEach(() => {
  vi.clearAllMocks();
  getPendingLink.mockResolvedValue(pending());
});

describe("POST /api/auth/link", () => {
  it("lie le compte, efface la demande et ouvre la session", async () => {
    linkGoogleAccount.mockResolvedValue({ id: "u1", email: "ada@example.fr", name: "Ada" });
    const res = await post("bon-mot-de-passe");
    expect(res.status).toBe(200);
    expect(setSessionCookie).toHaveBeenCalledWith("u1");
    expect(clearLinkCookie).toHaveBeenCalled();
  });

  it("renvoie 410 sans demande en attente", async () => {
    getPendingLink.mockResolvedValue(null);
    expect((await post("x")).status).toBe(410);
    expect(linkGoogleAccount).not.toHaveBeenCalled();
  });

  it("renvoie 401 pour un mot de passe incorrect, en gardant la demande ouverte", async () => {
    linkGoogleAccount.mockRejectedValue(new LinkError("invalid_password"));
    expect((await post("mauvais")).status).toBe(401);
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(clearLinkCookie).not.toHaveBeenCalled();
  });

  it("renvoie 409 et oublie la demande si le compte n'est pas liable", async () => {
    linkGoogleAccount.mockRejectedValue(new LinkError("unavailable"));
    expect((await post("x")).status).toBe(409);
    expect(clearLinkCookie).toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("limite les essais par adresse", async () => {
    const same = pending();
    getPendingLink.mockResolvedValue(same);
    linkGoogleAccount.mockRejectedValue(new LinkError("invalid_password"));
    for (let i = 0; i < 5; i++) expect((await post("mauvais")).status).toBe(401);
    expect((await post("mauvais")).status).toBe(429);
  });

  it("rejette un corps sans mot de passe", async () => {
    expect((await post("")).status).toBe(422);
  });
});

describe("DELETE /api/auth/link", () => {
  it("abandonne la liaison", async () => {
    expect((await DELETE()).status).toBe(200);
    expect(clearLinkCookie).toHaveBeenCalled();
  });
});
