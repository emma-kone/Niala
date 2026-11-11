// Route de retour Google : décisions de redirection et ouverture de session, Supabase et la base étant simulés.
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchangeCodeForSession = vi.fn();
const signOut = vi.fn(async () => ({ error: null }));
const setSessionCookie = vi.fn(async () => undefined);
const setLinkCookie = vi.fn(async () => undefined);
const signInWithGoogle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { exchangeCodeForSession, signOut } }) }));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), setSessionCookie, setLinkCookie }));
vi.mock("@/server/services/accounts", async (original) => ({ ...(await original<typeof import("@/server/services/accounts")>()), signInWithGoogle }));

const { GET } = await import("./route");
const { GoogleSignInError } = await import("@/server/services/accounts");

const googleUser = { id: "supabase-1", email: "ada@example.fr", user_metadata: { email_verified: true, full_name: "Ada Test" }, identities: [{ provider: "google", identity_data: { sub: "g-1", email_verified: true } }] };
const call = async (query: string) => {
  const res = await GET(new Request(`https://niala.test/auth/callback${query}`));
  return res.headers.get("location");
};

beforeEach(() => {
  vi.clearAllMocks();
  exchangeCodeForSession.mockResolvedValue({ data: { user: googleUser }, error: null });
  signInWithGoogle.mockResolvedValue({ id: "niala-1", email: "ada@example.fr", name: "Ada Test" });
});

describe("retour de la connexion Google", () => {
  it("ouvre la session Niala et ferme la session Supabase temporaire", async () => {
    expect(await call("?code=abc")).toBe("https://niala.test/");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(setSessionCookie).toHaveBeenCalledWith("niala-1");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("amène un compte tout juste créé au tableau de bord (la fenêtre de profil s'y affiche)", async () => {
    signInWithGoogle.mockResolvedValue({ id: "niala-2", email: "ada@example.fr", name: "Ada Test", created: true });
    expect(await call("?code=abc")).toBe("https://niala.test/");
    expect(setSessionCookie).toHaveBeenCalledWith("niala-2");
  });

  it("signale un refus de l'utilisateur chez Google", async () => {
    expect(await call("?error=access_denied")).toBe("https://niala.test/login?error=google_cancelled");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("n'ouvre aucune session sans code ou si l'échange échoue", async () => {
    expect(await call("")).toBe("https://niala.test/login?error=google_failed");
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "code invalide" } });
    expect(await call("?code=mauvais")).toBe("https://niala.test/login?error=google_failed");
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("propose de lier Google, sans ouvrir de session, quand l'adresse a un compte par mot de passe", async () => {
    signInWithGoogle.mockRejectedValue(new GoogleSignInError("account_exists"));
    expect(await call("?code=abc")).toBe("https://niala.test/auth/link");
    expect(setLinkCookie).toHaveBeenCalledWith({ sub: "g-1", email: "ada@example.fr", name: "Ada Test" });
    expect(setSessionCookie).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it("n'ouvre aucune session et n'offre pas la liaison en cas de conflit d'identité", async () => {
    signInWithGoogle.mockRejectedValue(new GoogleSignInError("account_conflict"));
    expect(await call("?code=abc")).toBe("https://niala.test/login?error=google_failed");
    expect(setLinkCookie).not.toHaveBeenCalled();
    expect(setSessionCookie).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur Supabase qui n'a pas d'identité Google", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "x", email: "a@b.fr", user_metadata: {}, identities: [{ provider: "email", identity_data: {} }] } }, error: null });
    expect(await call("?code=abc")).toBe("https://niala.test/login?error=google_failed");
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it("ignore toute destination de retour fournie dans l'adresse", async () => {
    expect(await call("?code=abc&next=https://exemple.invalid")).toBe("https://niala.test/");
  });
});
