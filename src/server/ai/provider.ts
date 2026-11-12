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
  /** Fichier joint (PDF ou image), lu directement par le modèle. Gemini uniquement. */
  attachment?: { mime: string; data: string };
}

export interface CompletionResult {
  text: string;
  model: string;
  /** Le modèle s'est arrêté sur sa limite de longueur : la réponse est incomplète. */
  truncated?: boolean;
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
  /** Reçoit le texte visible au fur et à mesure. Absent : la réponse est renvoyée d'un bloc. */
  onText?: (delta: string) => void;
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

/**
 * Nature d'un échec : surcharge du fournisseur, débit ou quota du fournisseur, délai dépassé, réseau, réponse vide,
 * contenu refusé, requête rejetée (modèle inconnu, paramètre invalide), ou autre (réponse inexploitable).
 */
export type AiFailureKind = "overload" | "rate_limit" | "timeout" | "network" | "empty" | "refused" | "request" | "other";

/** Échec d'appel ou réponse inexploitable (le détail reste dans les logs serveur). */
export class AiCallError extends Error {
  kind: AiFailureKind;
  constructor(message?: string, kind: AiFailureKind = "other") {
    super(message);
    this.kind = kind;
  }
}

/** Échec passager : un nouvel essai ou un autre modèle a une vraie chance d'aboutir. */
export const isTransientAiFailure = (e: unknown) => e instanceof AiCallError && ["overload", "rate_limit", "timeout", "network", "empty"].includes(e.kind);

const kindOfStatus = (status: number): AiFailureKind => (status === 429 ? "rate_limit" : status === 408 || status >= 500 ? "overload" : "request");

/**
 * Attentes entre deux essais d'un même appel (429 / 5xx / réseau) : croissantes, avec une part d'aléa pour que des
 * requêtes simultanées ne reviennent pas toutes au même instant. Modifiable par les tests.
 */
export const aiRetry = { delaysMs: [800, 2500, 6000] };

/** Attente interrompue si l'appel est annulé ou son délai dépassé. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AiCallError("Délai dépassé.", "timeout"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiCallError("Délai dépassé.", "timeout"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Durée d'attente avant l'essai suivant : celle demandée par le fournisseur (Retry-After, bornée à 10 s), sinon la progression prévue. */
function retryDelay(attempt: number, retryAfter?: string | null): number {
  const asked = Number(retryAfter);
  if (retryAfter && Number.isFinite(asked) && asked > 0) return Math.min(asked * 1000, 10_000);
  const base = aiRetry.delaysMs[Math.min(attempt, aiRetry.delaysMs.length - 1)] ?? 0;
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

const DEFAULT_MODEL = "claude-sonnet-5-5";
/** Modèles Gemini vérifiés sur l'API (liste des modèles du compte) et la documentation officielle. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const isAbort = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as { name?: string })?.name ?? "");

/** Appel HTTP Gemini avec reprises (429/5xx). La clé ne figure que dans l'en-tête, jamais dans l'URL ni les erreurs. */
async function geminiFetch(apiKey: string, path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const maxRetries = aiRetry.delaysMs.length;
  let lastError = "";
  let wait = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await pause(wait, signal);
    wait = retryDelay(attempt);
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
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          wait = retryDelay(attempt, res.headers.get("retry-after"));
          continue;
        }
        throw new AiCallError(lastError, kindOfStatus(res.status));
      }
      return res;
    } catch (e) {
      if (e instanceof AiCallError) throw e;
      if (isAbort(e)) throw new AiCallError("Délai dépassé.", "timeout");
      lastError = e instanceof Error ? e.message : "Erreur réseau";
      if (attempt === maxRetries) throw new AiCallError(lastError, "network");
    }
  }
  throw new AiCallError(lastError || "Échec de l'appel.");
}

export async function geminiPost(apiKey: string, path: string, body: unknown, signal: AbortSignal): Promise<Record<string, any>> {
  const res = await geminiFetch(apiKey, path, body, signal);
  try {
    return await res.json();
  } catch (e) {
    if (isAbort(e)) throw new AiCallError("Délai dépassé.", "timeout");
    throw new AiCallError("Réponse illisible.", "network");
  }
}

type RawPart = ChatPart & { text?: string; thought?: boolean; thoughtSignature?: string };

/** Appel en flux (SSE) : `onText` reçoit le texte visible au fil de l'eau ; renvoie des parties rejouables telles quelles. */
async function geminiStream(apiKey: string, path: string, body: unknown, signal: AbortSignal, onText: (d: string) => void) {
  const res = await geminiFetch(apiKey, `${path.replace(":generateContent", ":streamGenerateContent")}?alt=sse`, body, signal);
  if (!res.body) throw new AiCallError("Flux vide.");
  const parts: RawPart[] = [];
  let modelVersion: string | undefined;
  let blockReason: string | undefined;
  const take = (block: string) => {
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return;
    let chunk: Record<string, any>;
    try {
      chunk = JSON.parse(line.slice(5).trim());
    } catch {
      return;
    }
    modelVersion = chunk.modelVersion ?? modelVersion;
    blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
    for (const p of (chunk.candidates?.[0]?.content?.parts ?? []) as RawPart[]) {
      const prev = parts[parts.length - 1];
      const plain = typeof p.text === "string" && !p.thought && !p.thoughtSignature;
      if (plain && prev && typeof prev.text === "string" && !prev.thought && !prev.thoughtSignature) prev.text += p.text;
      else parts.push({ ...p });
      if (typeof p.text === "string" && !p.thought && p.text) onText(p.text);
    }
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        take(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
      }
    }
    if (buffer.trim()) take(buffer);
  } catch (e) {
    if (isAbort(e)) throw new AiCallError("Délai dépassé.", "timeout");
    throw new AiCallError("Flux interrompu.");
  }
  return { parts, modelVersion, blockReason };
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
    async complete({ system, user, maxTokens, temperature, signal, json, attachment }) {
      const data = await geminiPost(
        apiKey,
        `${encodeURIComponent(model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [...(attachment ? [{ inlineData: { mimeType: attachment.mime, data: attachment.data } }] : []), { text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature, ...(json ? { responseMimeType: "application/json" } : {}) },
        },
        signal
      );
      const text = textOf(data.candidates?.[0]?.content?.parts);
      if (!text.trim()) throw data.promptFeedback?.blockReason ? new AiCallError("Contenu refusé par le modèle.", "refused") : new AiCallError("Réponse vide.", "empty");
      return { text, model: data.modelVersion ?? model, truncated: data.candidates?.[0]?.finishReason === "MAX_TOKENS" };
    },
    async converse({ system, turns, tools, maxTokens, temperature, signal, onText }) {
      const path = `${encodeURIComponent(model)}:generateContent`;
      const body = {
        systemInstruction: { parts: [{ text: system }] },
        contents: turns,
        ...(tools?.length ? { tools: [{ functionDeclarations: tools }] } : {}),
        // Le chat privilégie la vitesse : réflexion minimale sur les modèles qui acceptent ce réglage.
        generationConfig: { maxOutputTokens: maxTokens, temperature, ...(/^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) },
      };
      let parts: ChatPart[];
      let version: string | undefined;
      let blockReason: string | undefined;
      let streamed = false;
      try {
        if (!onText) throw null;
        const out = await geminiStream(apiKey, path, body, signal, (d) => {
          streamed = true;
          onText(d);
        });
        ({ parts, modelVersion: version, blockReason } = out);
      } catch (e) {
        // Le flux a échoué avant le premier mot : on repasse par un appel classique plutôt que de perdre la réponse.
        if (streamed) throw e;
        const data = await geminiPost(apiKey, path, body, signal);
        parts = data.candidates?.[0]?.content?.parts ?? [];
        version = data.modelVersion;
        blockReason = data.promptFeedback?.blockReason;
        const fallback = textOf(parts as { text?: string; thought?: boolean }[]);
        if (onText && fallback) onText(fallback);
      }
      const calls = parts
        .filter((p) => p.functionCall)
        .map((p) => ({ name: String((p.functionCall as { name: string }).name), args: ((p.functionCall as { args?: Record<string, unknown> }).args ?? {}) as Record<string, unknown> }));
      const text = textOf(parts as { text?: string; thought?: boolean }[]);
      if (!calls.length && !text.trim()) throw new AiCallError(blockReason ? "Contenu refusé par le modèle." : "Réponse vide.");
      return { text, calls, modelParts: parts, model: version ?? model };
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
    async complete({ system, user, maxTokens, temperature, signal, attachment }) {
      if (attachment) throw new AiCallError("La lecture de fichiers nécessite Gemini.");
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
            throw new AiCallError(lastError, kindOfStatus(res.status));
          }
          const data = await res.json();
          const text = Array.isArray(data.content)
            ? data.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("")
            : "";
          if (!text.trim()) throw new AiCallError("Réponse vide.", "empty");
          return { text, model: data.model ?? model, truncated: data.stop_reason === "max_tokens" };
        } catch (e) {
          if (e instanceof AiCallError) throw e;
          if ((e as { name?: string })?.name === "TimeoutError" || (e as { name?: string })?.name === "AbortError") throw new AiCallError("Délai dépassé.", "timeout");
          lastError = e instanceof Error ? e.message : "Erreur réseau";
          if (attempt === maxRetries) throw new AiCallError(lastError, "network");
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

/** Modèle de repli vérifié disponible sur le compte (voir docs/ENVIRONNEMENT.md) : plus lent, mais sur une autre capacité que le modèle principal. */
export const DEFAULT_GEMINI_FALLBACK_MODELS = "gemini-3.6-flash";

/**
 * Modèles de repli, essayés dans l'ordre quand le modèle principal est surchargé, limité en débit ou trop lent.
 * Même fournisseur et même clé que le modèle principal : aucune donnée ne part chez un autre prestataire.
 * GEMINI_FALLBACK_MODELS (liste séparée par des virgules) ; valeur vide ou « none » : aucun repli.
 */
export function getFallbackProviders(): AiProvider[] {
  if (override !== undefined) return [];
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (!gemini) return [];
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const raw = process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_GEMINI_FALLBACK_MODELS;
  const models = raw.split(",").map((m) => m.trim()).filter((m) => m && m.toLowerCase() !== "none" && m !== primary);
  return [...new Set(models)].map((m) => geminiProvider(gemini, m));
}

export const isAiConfigured = () => getProvider() !== null;
