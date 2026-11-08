import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiProvider } from "./provider";

const sse = (...chunks: unknown[]) => new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`).join(""), { status: 200 });
const text = (t: string, extra = {}) => ({ candidates: [{ content: { parts: [{ text: t, ...extra }] } }] });
const request = (onText?: (d: string) => void) => ({ system: "s", turns: [{ role: "user" as const, parts: [{ text: "q" }] }], maxTokens: 10, temperature: 0, signal: AbortSignal.timeout(5000), onText });
const provider = geminiProvider("key", "gemini-3.5-flash-lite");

afterEach(() => vi.unstubAllGlobals());

describe("réponse en flux", () => {
  it("transmet le texte morceau par morceau et ignore la réflexion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(text("réflexion", { thought: true }), text("Bon"), text("jour"))));
    const seen: string[] = [];
    const r = await provider.converse!(request((d) => seen.push(d)));
    expect(seen).toEqual(["Bon", "jour"]);
    expect(r.text).toBe("Bonjour");
  });

  it("restitue les appels d'outils et leur signature pour le tour suivant", async () => {
    const call = { functionCall: { name: "search_web", args: { query: "x" } }, thoughtSignature: "sig" };
    vi.stubGlobal("fetch", vi.fn(async () => sse({ candidates: [{ content: { parts: [call] } }] })));
    const r = await provider.converse!(request(() => undefined));
    expect(r.calls).toEqual([{ name: "search_web", args: { query: "x" } }]);
    expect(r.modelParts).toEqual([call]);
  });

  it("repasse par un appel classique si le flux échoue avant le premier mot", async () => {
    const fetchMock = vi.fn(async (url: string) => (String(url).includes("stream") ? new Response(null, { status: 400 }) : Response.json(text("Réponse de secours"))));
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];
    const r = await provider.converse!(request((d) => seen.push(d)));
    expect(r.text).toBe("Réponse de secours");
    expect(seen).toEqual(["Réponse de secours"]);
  });

  it("sans abonné au texte, reste un appel classique", async () => {
    const fetchMock = vi.fn(async (_url: string) => Response.json(text("ok")));
    vi.stubGlobal("fetch", fetchMock);
    await provider.converse!(request());
    expect(fetchMock.mock.calls[0][0]).toContain(":generateContent");
  });
});
