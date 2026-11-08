import { geminiPost } from "./provider";
import { TRUSTED_DOMAINS, hostOf, trustTier, type TrustTier } from "@/server/domain/web-trust";

// ─────────────────────────────────────────────────────────────────────────────
// Recherche web pour appuyer les cours. Trois moteurs, appelés UNIQUEMENT depuis le serveur, dans cet ordre :
//  1. Tavily (TAVILY_API_KEY) : recherche d'abord limitée aux domaines de référence, puis élargie ;
//  2. Google Search via Gemini (« grounding ») : nécessite un plan Gemini qui l'autorise (sinon 429) ;
//  3. Wikipédia (français puis anglais) : gratuit et sans clé, toujours disponible en dernier recours.
// Chaque résultat est classé « source reconnue » ou « source à vérifier » par le serveur, jamais par l'IA.
// ─────────────────────────────────────────────────────────────────────────────

export interface WebResult {
  title: string;
  url: string;
  host: string;
  snippet: string;
  tier: TrustTier;
}

export type WebBackend = "tavily" | "gemini" | "wikipedia";

export interface WebSearchOutcome {
  backend: WebBackend;
  summary?: string;
  results: WebResult[];
}

export class WebSearchUnavailableError extends Error {}

export interface WebSearcher {
  search(query: string, signal: AbortSignal): Promise<WebSearchOutcome>;
}

const CACHE_MS = 60 * 60_000;
/** Identifiant générique exigé par la politique d'accès des API Wikimedia (aucune donnée personnelle). */
const USER_AGENT = "NialaStudy/1.0 (plateforme d'apprentissage ; recherche de sources)";
let groundingBlockedUntil = 0;
let groundingOkUntil = 0;
let override: WebSearcher | null | undefined;

/** RÉSERVÉ AUX TESTS. */
export function __setWebSearcherForTests(s: WebSearcher | null | undefined) {
  override = s;
}

const wikipediaEnabled = () => process.env.WEB_SEARCH_WIKIPEDIA?.trim().toLowerCase() !== "off" && !process.env.VITEST;
const geminiGroundingUsable = () => !!process.env.GEMINI_API_KEY?.trim() && Date.now() > groundingBlockedUntil;

/** Meilleur moteur disponible, sans appel réseau (Gemini : sous réserve du test réel fait par `webStatus`). */
export function webBackend(): WebBackend | null {
  if (override) return "tavily";
  if (process.env.TAVILY_API_KEY?.trim()) return "tavily";
  if (geminiGroundingUsable()) return "gemini";
  if (wikipediaEnabled()) return "wikipedia";
  return null;
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);
const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function toResult(title: string, url: string, snippet: string, host = hostOf(url)): WebResult | null {
  if (!host || !/^https?:\/\//i.test(url)) return null;
  return { title: clip(title || host, 140), url, host, snippet: clip(snippet, 700), tier: trustTier(host) };
}

// ── Tavily ───────────────────────────────────────────────────────────────────

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

async function tavilySearch(key: string, query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
  let results = await tavily(key, query, signal, true);
  if (results.length < 2) {
    const wide = await tavily(key, query, signal, false);
    const seen = new Set(results.map((r) => r.url));
    results = [...results, ...wide.filter((r) => !seen.has(r.url))].slice(0, 6);
  }
  return { backend: "tavily", results };
}

// ── Google Search via Gemini ─────────────────────────────────────────────────

/**
 * Les liens renvoyés par Gemini passent par un redirecteur Google (vertexaisearch.cloud.google.com) ;
 * le vrai domaine est alors donné dans le titre. Sans cette correction, toute source serait « à vérifier ».
 */
function groundedHost(uri: string, title: string): string | null {
  const host = hostOf(uri);
  if (host && !/(^|\.)vertexaisearch\.cloud\.google\.com$/.test(host)) return host;
  const fromTitle = title.trim().toLowerCase().replace(/^www\./, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(fromTitle) ? fromTitle : null;
}

async function geminiGrounding(query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
  const key = process.env.GEMINI_API_KEY!.trim();
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
  try {
    const data = await geminiPost(
      key,
      `${encodeURIComponent(model)}:generateContent`,
      {
        contents: [{ role: "user", parts: [{ text: `Réponds de façon factuelle et concise (6 phrases maximum), en t'appuyant sur des sources officielles ou universitaires. Si tu ne trouves pas, dis-le. Question : ${query}` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 800, temperature: 0 },
      },
      signal
    );
    const cand = data.candidates?.[0];
    const text = ((cand?.content?.parts ?? []) as { text?: string; thought?: boolean }[]).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
    const chunks = (cand?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri?: string; title?: string } }[];
    const supports = (cand?.groundingMetadata?.groundingSupports ?? []) as { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
    // Pour chaque source, uniquement les phrases de la synthèse qu'elle soutient réellement.
    const backed = chunks.map((_, i) => supports.filter((s) => s.groundingChunkIndices?.includes(i)).map((s) => s.segment?.text ?? "").filter(Boolean).join(" "));
    const results = chunks
      .map((c, i) => {
        const uri = c.web?.uri ?? "";
        const title = c.web?.title ?? "";
        return toResult(title, uri, backed[i] || "(source consultée par le moteur, sans passage précis rattaché)", groundedHost(uri, title));
      })
      .filter((r): r is WebResult => !!r);
    groundingOkUntil = Date.now() + CACHE_MS;
    return { backend: "gemini", summary: clip(text, 1500), results: results.slice(0, 6) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    // Quota ou droit absent : on arrête d'essayer pendant une heure plutôt que de rejouer l'échec à chaque message.
    if (/quota|billing|permission|not supported|RESOURCE_EXHAUSTED/i.test(message)) groundingBlockedUntil = Date.now() + CACHE_MS;
    throw new WebSearchUnavailableError("Google Search via Gemini indisponible (quota ou plan).");
  }
}

// ── Wikipédia (sans clé) ─────────────────────────────────────────────────────

async function wikiGet(lang: "fr" | "en", params: Record<string, string>, signal: AbortSignal): Promise<Record<string, any>> {
  const url = `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ format: "json", formatversion: "2", utf8: "1", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT }, signal });
  if (!res.ok) throw new WebSearchUnavailableError(`Wikipédia HTTP ${res.status}`);
  return res.json();
}

async function wikipediaLang(lang: "fr" | "en", query: string, signal: AbortSignal): Promise<WebResult[]> {
  const found = await wikiGet(lang, { action: "query", list: "search", srsearch: query, srlimit: "3", srprop: "snippet" }, signal);
  const hits = (found.query?.search ?? []) as { title: string; pageid: number; snippet?: string }[];
  if (!hits.length) return [];
  // Introduction de chaque article + passage où la requête apparaît (extrait de recherche).
  const pages = await wikiGet(lang, { action: "query", prop: "extracts|info", inprop: "url", exintro: "1", explaintext: "1", exchars: "500", pageids: hits.map((h) => h.pageid).join("|") }, signal);
  const byId = new Map(((pages.query?.pages ?? []) as { pageid: number; extract?: string; fullurl?: string }[]).map((p) => [p.pageid, p]));
  return hits
    .map((h) => {
      const page = byId.get(h.pageid);
      const match = h.snippet ? `Passage correspondant : « …${stripHtml(h.snippet)}… »` : "";
      const intro = page?.extract ? `Introduction : ${page.extract}` : "";
      return toResult(`${h.title} — Wikipédia`, page?.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`, [match, intro].filter(Boolean).join(" "));
    })
    .filter((r): r is WebResult => !!r);
}

async function wikipediaSearch(query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
  try {
    let results = await wikipediaLang("fr", query, signal);
    if (results.length < 2) results = [...results, ...(await wikipediaLang("en", query, signal))].slice(0, 5);
    return { backend: "wikipedia", results };
  } catch (e) {
    if (e instanceof WebSearchUnavailableError) throw e;
    throw new WebSearchUnavailableError("Wikipédia injoignable.");
  }
}

// ── Point d'entrée ───────────────────────────────────────────────────────────

export async function searchWeb(query: string, signal: AbortSignal): Promise<WebSearchOutcome> {
  if (override) return override.search(query, signal);
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  if (tavilyKey) return tavilySearch(tavilyKey, query, signal);
  if (geminiGroundingUsable()) {
    try {
      return await geminiGrounding(query, signal);
    } catch (e) {
      if (!wikipediaEnabled()) throw e;
    }
  }
  if (wikipediaEnabled()) return wikipediaSearch(query, signal);
  throw new WebSearchUnavailableError("Aucun moteur de recherche web n'est configuré.");
}

/**
 * Moteur réellement utilisable. Pour Google Search via Gemini, un appel d'essai (mis en cache une heure)
 * évite d'annoncer une fonction que le plan de l'étudiant n'autorise pas ; à défaut, Wikipédia prend le relais.
 */
export async function webStatus(): Promise<WebBackend | null> {
  const backend = webBackend();
  if (backend !== "gemini" || Date.now() < groundingOkUntil) return backend;
  try {
    await geminiGrounding("Android Activity lifecycle", AbortSignal.timeout(20_000));
    return "gemini";
  } catch {
    groundingBlockedUntil = Math.max(groundingBlockedUntil, Date.now() + CACHE_MS);
    return webBackend();
  }
}
