import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// Couche d'abstraction IA : Anthropic Claude Sonnet 5.5 (retry sur saturation).
// Les détails d'erreur restent dans les logs serveur ; l'interface ne reçoit
// que des messages génériques.
// ─────────────────────────────────────────────────────────────────────────────

export type AiOp = "analysis" | "rag" | "generation" | "grading" | "explain" | "revision";
export type AiProvider = "anthropic";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

interface CompletionResult {
  ok: boolean;
  content: string;
  error?: string;
  model?: string;
  provider?: AiProvider;
}

const DEFAULT_TIMEOUT_MS = 120_000;

// ── Appel Anthropic (Claude Sonnet 5.5, fournisseur principal) ───────────────
async function callAnthropic(
  systemPrompt: string,
  userPrompt: string,
  opts: { model?: string; timeoutMs?: number; temperature?: number; json?: boolean } = {}
): Promise<{ ok: boolean; content: string; model: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, content: "", model: "anthropic", error: "ANTHROPIC_API_KEY manquante." };
  }

  // On n'accepte qu'un identifiant Claude.
  const requested = opts.model?.startsWith("claude") ? opts.model : undefined;
  const model = requested || process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Pas de mode JSON natif : on le demande explicitement dans le system prompt.
  const system = opts.json
    ? `${systemPrompt}\n\nRéponds UNIQUEMENT avec un JSON valide, sans texte autour ni bloc de code.`.trim()
    : systemPrompt;

  const bodyPayload: Record<string, unknown> = {
    model,
    max_tokens: 8192,
    temperature: opts.temperature ?? 0.3,
    messages: [{ role: "user", content: userPrompt }],
    ...(system.trim() ? { system } : {}),
  };

  const maxRetries = 2;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        console.warn(`[Anthropic] Nouvelle tentative (${attempt}/${maxRetries}) suite à saturation...`);
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey.trim(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        const msg = errData?.error?.message || `Erreur Anthropic (${res.status} ${res.statusText})`;
        lastError = msg;

        // 429 / 5xx / 529 (overloaded) : erreurs temporaires, on retente
        const isTemporary = res.status === 429 || res.status >= 500;
        if (isTemporary && attempt < maxRetries) continue;

        return { ok: false, content: "", model, error: msg };
      }

      const data = await res.json();
      const content: string = Array.isArray(data.content)
        ? data.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("")
        : "";
      if (!content.trim()) {
        return { ok: false, content: "", model, error: "Réponse vide d'Anthropic." };
      }

      return { ok: true, content, model: data.model || model };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Erreur réseau inconnue";
      if (attempt < maxRetries) continue;
    }
  }

  return { ok: false, content: "", model, error: lastError || "Échec de l'appel Anthropic" };
}

const USER_ERROR = "Le service d'IA est momentanément indisponible. Réessayez dans un instant.";

async function callModel(
  op: AiOp,
  systemPrompt: string,
  userPrompt: string,
  opts: { userId?: string; model?: string; timeoutMs?: number; temperature?: number; json?: boolean } = {}
): Promise<CompletionResult> {
  const started = Date.now();
  const promptChars = systemPrompt.length + userPrompt.length;

  const res = await callAnthropic(systemPrompt, userPrompt, opts);

  if (res.ok) {
    await log(op, opts.userId, `anthropic:${res.model}`, promptChars, res.content.length, true, undefined, Date.now() - started);
    return { ok: true, content: res.content, model: res.model, provider: "anthropic" };
  }

  console.warn(`[AI] Échec de l'appel (${op}): ${res.error}`);
  await log(op, opts.userId, "anthropic", promptChars, 0, false, res.error, Date.now() - started);
  return { ok: false, content: "", error: USER_ERROR };
}

async function log(
  op: AiOp,
  userId: string | undefined,
  model: string | undefined,
  promptChars: number,
  respChars: number,
  ok: boolean,
  error?: string,
  durationMs?: number
) {
  try {
    await db.aIUsageLog.create({
      data: {
        userId: userId ?? null,
        op,
        model: model ?? null,
        promptChars,
        respChars,
        ok,
        error: error ?? null,
        durationMs: durationMs ?? null,
      },
    });
  } catch {
    /* journalisation best-effort */
  }
}

/** Extrait un objet JSON d'une réponse LLM (tolère les blocs ```json). */
export function parseJsonLoose<T>(raw: string): T | null {
  const cleaned = raw
    .replace(/```json\s*/gi, "```")
    .split("```")
    .map((s) => s.trim())
    .filter(Boolean);
  const candidates = [raw, ...cleaned];
  for (const c of candidates) {
    const start = Math.min(...[c.indexOf("{"), c.indexOf("[")].filter((i) => i >= 0).concat([Number.MAX_SAFE_INTEGER]));
    if (start === Number.MAX_SAFE_INTEGER) continue;
    const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
    if (end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as T;
    } catch {
      continue;
    }
  }
  return null;
}

export const ai = {
  async complete(
    op: AiOp,
    systemPrompt: string,
    userPrompt: string,
    opts?: { userId?: string; model?: string; timeoutMs?: number; temperature?: number }
  ) {
    return callModel(op, systemPrompt, userPrompt, opts);
  },

  /** Appel avec attente d'un JSON valide (1 re-tentative de réparation). */
  async completeJson<T>(
    op: AiOp,
    systemPrompt: string,
    userPrompt: string,
    opts?: { userId?: string; model?: string; timeoutMs?: number; temperature?: number }
  ): Promise<{ ok: boolean; data: T | null; error?: string; raw?: string; model?: string; provider?: string }> {
    const first = await callModel(op, systemPrompt, userPrompt, { ...opts, json: true });
    if (!first.ok) return { ok: false, data: null, error: first.error, model: first.model, provider: first.provider };
    const parsed = parseJsonLoose<T>(first.content);
    if (parsed) return { ok: true, data: parsed, raw: first.content, model: first.model, provider: first.provider };

    // Réparation : on redemande uniquement le JSON
    const repair = await callModel(
      op,
      "Tu corriges des sorties JSON. Réponds UNIQUEMENT avec le JSON valide, sans aucun texte autour, sans bloc de code.",
      `La réponse suivante devait être un JSON valide mais ne l'est pas. Répare-la et réponds UNIQUEMENT avec le JSON.\n\n${first.content.slice(0, 8000)}`,
      { ...opts, timeoutMs: 60_000, json: true }
    );
    if (repair.ok) {
      const reparsed = parseJsonLoose<T>(repair.content);
      if (reparsed) return { ok: true, data: reparsed, raw: first.content, model: repair.model, provider: repair.provider };
    }
    return {
      ok: false,
      data: null,
      error: "Impossible d'obtenir une réponse JSON valide du modèle.",
      raw: first.content,
      model: first.model,
      provider: first.provider,
    };
  },
};
