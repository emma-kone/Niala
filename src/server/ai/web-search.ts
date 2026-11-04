import { geminiPost } from "./provider";
import { TRUSTED_DOMAINS, hostOf, trustTier, type TrustTier } from "@/server/domain/web-trust";

// ─────────────────────────────────────────────────────────────────────────────
// Recherche web pour appuyer les cours. Deux moteurs, appelés UNIQUEMENT depuis le serveur :
//  1. Tavily (TAVILY_API_KEY) : recherche d'abord limitée aux domaines de référence, puis élargie ;
//  2. Google Search via Gemini (« grounding ») : nécessite un plan Gemini qui l'autorise (sinon 429).
// Chaque résultat est classé « source reconnue » ou « source à vérifier » par le serveur.
// ─────────────────────────────────────────────────────────────────────────────

export interface WebResult {
  title: string;
  url: string;
  host: string;
  snippet: string;
  tier: TrustTier;
}

export interface WebSearchOutcome {
  backend: "tavily" | "gemini";
  summary?: string;
  results: WebResult[];
}

export class WebSearchUnavailableError extends Error {}

export interface WebSearcher {
  search(query: string, signal: AbortSignal): Promise<WebSearchOutcome>;
}

const CACHE_MS = 60 * 60_000;
let groundingBlockedUntil = 0;
let groundingOkUntil = 0;
let override: WebSearcher | null | undefined;

/** RÉSERVÉ AUX TESTS. */
export function __setWebSearcherForTests(s: WebSearcher | null | undefined) {
  override = s;
}

export type WebBackend = "tavily" | "gemini" | null;

/** Moteur disponible, sans appel réseau (Gemini : sous réserve du test réel fait par `webStatus`). */
export function webBackend(): WebBackend {
  if (override) return "tavily";
  if (process.env.TAVILY_API_KEY?.trim()) return "tavily";
  if (process.env.GEMINI_API_KEY?.trim() && Date.now() > groundingBlockedUntil) return "gemini";
  return null;
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

function toResult(title: string, url: string, snippet: string): WebResult | null {
  const host = hostOf(url);
  if (!host || !/^https?:\/\//i.test(url)) return null;
  return { title: clip(title || host, 140), url, host, snippet: clip(snippet, 700), tier: trustTier(host) };
}

async function tavily(key: string, query: string, signal: AbortSignal, restrict: boolean): Promise<WebResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 6, include_answer: false, ...(restrict ? { include_domains: [...TRUSTED_DOMAINS] } : {}) }),
    signal,
  });
  if (!res.ok) throw new WebSearchUnavailableError(`Tavily HTTP ${res.status}`);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (data.results ?? []).map((r) => toResult(r.title ?? "", r.url ?? "", r.content ?? "")).filter((r): r is WebResult => !!r);
}

async function geminiGrounding(query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
  const key = process.env.GEMINI_API_KEY!.trim();
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  try {
    const data = await geminiPost(
      key,
      `${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{ role: "user", parts: [{ text: `Réponds de façon factuelle et concise (6 phrases maximum), en t'appuyant sur des sources officielles ou universitaires : ${query}` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 800, temperature: 0 },
      },
      signal
    );
    const cand = data.candidates?.[0];
    const text = ((cand?.content?.parts ?? []) as { text?: string; thought?: boolean }[]).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
    const chunks = (cand?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri?: string; title?: string } }[];
    const results = chunks.map((c) => toResult(c.web?.title ?? "", c.web?.uri ?? "", text)).filter((r): r is WebResult => !!r);
    groundingOkUntil = Date.now() + CACHE_MS;
    return { backend: "gemini", summary: clip(text, 1500), results: results.slice(0, 6) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // Quota ou droit absent : on arrête d'essayer pendant une heure plutôt que de rejouer l'échec à chaque message.
    if (/quota|billing|permission|not supported|RESOURCE_EXHAUSTED/i.test(message)) groundingBlockedUntil = Date.now() + CACHE_MS;
    throw new WebSearchUnavailableError("Google Search via Gemini indisponible (quota ou plan).");
  }
}

export async function searchWeb(query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
  if (override) return override.search(query, signal);
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  if (tavilyKey) {
    let results = await tavily(tavilyKey, query, signal, true);
    if (results.length < 2) {
      const wide = await tavily(tavilyKey, query, signal, false);
      const seen = new Set(results.map((r) => r.url));
      results = [...results, ...wide.filter((r) => !seen.has(r.url))].slice(0, 6);
    }
    return { backend: "tavily", results };
  }
  if (webBackend() === "gemini") return geminiGrounding(query, signal);
  throw new WebSearchUnavailableError("Aucun moteur de recherche web n'est configuré.");
}

/**
 * Moteur réellement utilisable. Pour Google Search via Gemini, un appel d'essai (mis en cache une heure)
 * évite d'annoncer une fonction que le plan de l'étudiant n'autorise pas.
 */
export async function webStatus(): Promise<WebBackend> {
  const backend = webBackend();
  if (backend !== "gemini" || Date.now() < groundingOkUntil) return backend;
  try {
    await geminiGrounding("Android Activity lifecycle", AbortSignal.timeout(20_000));
    return "gemini";
  } catch {
    groundingBlockedUntil = Math.max(groundingBlockedUntil, Date.now() + CACHE_MS);
    return null;
  }
}
