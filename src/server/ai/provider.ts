// ─────────────────────────────────────────────────────────────────────────────
// Fournisseur IA : interface minimale + implémentations Google Gemini (principal) et Anthropic (repli).
// La clé (GEMINI_API_KEY) n'est lue que côté serveur, envoyée dans l'en-tête x-goog-api-key, et n'apparaît
// jamais dans une URL, un message d'erreur ou un journal.
// Aucun appel IA ne se fait en dehors de cette couche (ni dans les composants React,
// ni dans les routes API) : les services métier passent par `generateStructured`.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
  /** Demande une sortie JSON (mode JSON natif de Gemini). */
  json?: boolean;
}

export interface CompletionResult {
  text: string;
  model: string;
}

/** Élément de conversation opaque (format du fournisseur) : les appels d'outils doivent être renvoyés tels quels. */
export type ChatPart = Record<string, unknown>;
export interface ChatTurn {
  role: "user" | "model";
  parts: ChatPart[];
}
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: { type: "OBJECT"; properties: Record<string, { type: "STRING" | "INTEGER"; description?: string }>; required?: string[] };
}
export interface ConverseRequest {
  system: string;
  turns: ChatTurn[];
  tools?: ToolDeclaration[];
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
}
export interface ConverseResult {
  text: string;
  calls: { name: string; args: Record<string, unknown> }[];
  /** Réponse brute du modèle, à rejouer telle quelle dans l'historique avant les résultats d'outils. */
  modelParts: ChatPart[];
  model: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly embeddingModel?: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** Conversation à plusieurs tours avec appels d'outils (Gemini uniquement). */
  converse?(req: ConverseRequest): Promise<ConverseResult>;
  /** Vecteurs sémantiques normalisés (Gemini uniquement). */
  embed?(texts: string[], task: "document" | "query", signal: AbortSignal): Promise<number[][]>;
}

/** Aucun fournisseur configuré (GEMINI_API_KEY absente). */
export class AiUnavailableError extends Error {
  constructor(message = "Le service d'IA n'est pas configuré.") {
    super(message);
  }
}

/** Limite de consommation atteinte. */
export class AiQuotaError extends Error {}

/** Échec d'appel ou réponse inexploitable (le détail reste dans les logs serveur). */
export class AiCallError extends Error {}

const DEFAULT_MODEL = "claude-sonnet-5-5";
/** Modèles Gemini vérifiés sur l'API (liste des modèles du compte) et la documentation officielle. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const isAbort = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as { name?: string })?.name ?? "");

/** Appel HTTP Gemini avec reprises (429/5xx). La clé ne figure que dans l'en-tête, jamais dans l'URL ni les erreurs. */
export async function geminiPost(apiKey: string, path: string, body: unknown, signal: AbortSignal): Promise<Record<string, any>> {
  const maxRetries = 2;
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500));
    try {
      const res = await fetch(`${GEMINI_ENDPOINT}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        lastError = err?.error?.message ?? `HTTP ${res.status}`;
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) continue;
        throw new AiCallError(lastError);
      }
      return await res.json();
    } catch (e) {
      if (e instanceof AiCallError) throw e;
      if (isAbort(e)) throw new AiCallError("Délai dépassé.");
      lastError = e instanceof Error ? e.message : "Erreur réseau";
      if (attempt === maxRetries) throw new AiCallError(lastError);
    }
  }
  throw new AiCallError(lastError || "Échec de l'appel.");
}

const textOf = (parts: { text?: string; thought?: boolean }[] | undefined) =>
  (parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");

function l2normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export const EMBEDDING_DIMENSIONS = 768;
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";

export function geminiProvider(apiKey: string, model: string, embeddingModel = DEFAULT_EMBEDDING_MODEL): AiProvider {
  return {
    name: "gemini",
    model,
    embeddingModel,
    async complete({ system, user, maxTokens, temperature, signal, json }) {
      const data = await geminiPost(
        apiKey,
        `${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature, ...(json ? { responseMimeType: "application/json" } : {}) },
        },
        signal
      );
      const text = textOf(data.candidates?.[0]?.content?.parts);
      if (!text.trim()) throw new AiCallError(data.promptFeedback?.blockReason ? "Contenu refusé par le modèle." : "Réponse vide.");
      return { text, model: data.modelVersion ?? model };
    },
    async converse({ system, turns, tools, maxTokens, temperature, signal }) {
      const data = await geminiPost(
        apiKey,
        `${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: turns,
          ...(tools?.length ? { tools: [{ functionDeclarations: tools }] } : {}),
          generationConfig: { maxOutputTokens: maxTokens, temperature },
        },
        signal
      );
      const parts: ChatPart[] = data.candidates?.[0]?.content?.parts ?? [];
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p) => ({ name: String((p.functionCall as { name: string }).name), args: ((p.functionCall as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown> }));
      const text = textOf(parts as { text?: string; thought?: boolean }[]);
      if (!calls.length && !text.trim()) throw new AiCallError(data.promptFeedback?.blockReason ? "Contenu refusé par le modèle." : "Réponse vide.");
      return { text, calls, modelParts: parts, model: data.modelVersion ?? model };
    },
    async embed(texts, task, signal) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 50) {
        const batch = texts.slice(i, i + 50);
        const data = await geminiPost(
          apiKey,
          `${encodeURIComponent(embeddingModel)}:batchEmbedContents`,
          {
            requests: batch.map((t) => ({
              model: `models/${embeddingModel}`,
              content: { parts: [{ text: t.slice(0, 8000) }] },
              taskType: task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
              outputDimensionality: EMBEDDING_DIMENSIONS,
            })),
          },
          signal
        );
        const vectors: { values?: number[] }[] = data.embeddings ?? [];
        if (vectors.length !== batch.length || vectors.some((v) => !v.values?.length)) throw new AiCallError("Vecteurs sémantiques invalides.");
        out.push(...vectors.map((v) => l2normalize(v.values!)));
      }
      return out;
    },
  };
}

export function anthropicProvider(apiKey: string, model: string): AiProvider {
  return {
    name: "anthropic",
    model,
    async complete({ system, user, maxTokens, temperature, signal }) {
      const maxRetries = 2;
      let lastError = "";
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500));
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content: user }] }),
            signal,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            lastError = body?.error?.message ?? `HTTP ${res.status}`;
            if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) continue;
            throw new AiCallError(lastError);
          }
          const data = await res.json();
          const text = Array.isArray(data.content)
            ? data.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("")
            : "";
          if (!text.trim()) throw new AiCallError("Réponse vide.");
          return { text, model: data.model ?? model };
        } catch (e) {
          if (e instanceof AiCallError) throw e;
          if ((e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError") throw new AiCallError("Délai dépassé.");
          lastError = e instanceof Error ? e.message : "Erreur réseau";
          if (attempt === maxRetries) throw new AiCallError(lastError);
        }
      }
      throw new AiCallError(lastError || "Échec de l'appel.");
    },
  };
}

let override: AiProvider | null | undefined;

/** RÉSERVÉ AUX TESTS : injecte un faux fournisseur (jamais utilisé en production). */
export function __setProviderForTests(p: AiProvider | null | undefined) {
  override = p;
}

export function getProvider(): AiProvider | null {
  if (override !== undefined) return override;
  // Gemini est le fournisseur principal ; Anthropic ne sert que de repli si seule sa clé est définie.
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (gemini) return geminiProvider(gemini, process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, process.env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL);
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return anthropicProvider(key, process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL);
}

export const isAiConfigured = () => getProvider() !== null;
