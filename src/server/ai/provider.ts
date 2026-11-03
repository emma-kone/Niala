// ─────────────────────────────────────────────────────────────────────────────
// Fournisseur IA : interface minimale + implémentation Anthropic.
// Aucun appel IA ne se fait en dehors de cette couche (ni dans les composants React,
// ni dans les routes API) : les services métier passent par `generateStructured`.
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
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

/** Aucun fournisseur configuré (ANTHROPIC_API_KEY absente). */
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
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return null;
  return anthropicProvider(key, process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL);
}

export const isAiConfigured = () => getProvider() !== null;
