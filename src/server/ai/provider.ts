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

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(req: CompletionRequest): Promise<CompletionResult>;
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

export function geminiProvider(apiKey: string, model: string): AiProvider {
  return {
    name: "gemini",
    model,
    async complete({ system, user, maxTokens, temperature, signal, json }) {
      const maxRetries = 2;
      let lastError = "";
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, attempt * 1500));
        try {
          const res = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: user }] }],
              generationConfig: { maxOutputTokens: maxTokens, temperature, ...(json ? { responseMimeType: "application/json" } : {}) },
            }),
            signal,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            lastError = body?.error?.message ?? `HTTP ${res.status}`;
            if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) continue;
            throw new AiCallError(lastError);
          }
          const data = await res.json();
          const parts: { text?: string; thought?: boolean }[] = data.candidates?.[0]?.content?.parts ?? [];
          const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
          if (!text.trim()) throw new AiCallError(data.promptFeedback?.blockReason ? "Contenu refusé par le modèle." : "Réponse vide.");
          return { text, model: data.modelVersion ?? model };
        } catch (e) {
          if (e instanceof AiCallError) throw e;
          if (isAbort(e)) throw new AiCallError("Délai dépassé.");
          lastError = e instanceof Error ? e.message : "Erreur réseau";
          if (attempt === maxRetries) throw new AiCallError(lastError);
        }
      }
      throw new AiCallError(lastError || "Échec de l'appel.");
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
  if (gemini) return geminiProvider(gemini, process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return anthropicProvider(key, process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL);
}

export const isAiConfigured = () => getProvider() !== null;
