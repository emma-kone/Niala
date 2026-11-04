import type { ZodType } from "zod";
import { db } from "@/lib/db";
import { parseJsonLoose } from "./json";
import { AiCallError, AiQuotaError, AiUnavailableError, getProvider } from "./provider";

// ─────────────────────────────────────────────────────────────────────────────
// Appel IA à sortie STRUCTURÉE : quota, délai, journal, validation stricte (zod),
// une tentative de réparation. L'IA n'est jamais source de vérité : la validité d'une
// réponse est décidée ici, par schéma.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;
const dailyLimit = () => Math.max(1, Number(process.env.AI_DAILY_CALL_LIMIT) || 300);

export interface StructuredRequest<T> {
  userId: string;
  /** Opération journalisée, ex. « analysis.concepts ». */
  op: string;
  /** Version du prompt : fait partie de la traçabilité des analyses. */
  promptVersion: string;
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
}

async function log(userId: string, op: string, model: string | undefined, promptChars: number, respChars: number, ok: boolean, error: string | undefined, started: number) {
  try {
    await db.aIUsageLog.create({ data: { userId, op, model: model ?? null, promptChars, respChars, ok, error: error?.slice(0, 500) ?? null, durationMs: Date.now() - started } });
  } catch {
    /* journalisation au mieux */
  }
}

export async function checkQuota(userId: string) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const used = await db.aIUsageLog.count({ where: { userId, createdAt: { gte: since } } });
  if (used >= dailyLimit()) {
    throw new AiQuotaError(`Limite quotidienne d'appels IA atteinte (${dailyLimit()}). Réessayez demain.`);
  }
}

export async function generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const provider = getProvider();
  if (!provider) throw new AiUnavailableError();
  await checkQuota(req.userId);

  const op = `${req.op}@${req.promptVersion}`;
  const system = `${req.system}\n\nRéponds UNIQUEMENT avec un JSON valide, sans texte autour ni bloc de code.`;
  let user = req.user;
  let lastIssue = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    let text = "";
    let model = provider.model;
    try {
      const res = await provider.complete({
        system,
        user,
        maxTokens: req.maxTokens ?? 6000,
        temperature: req.temperature ?? 0.1,
        json: true,
        signal: AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      text = res.text;
      model = res.model;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur inconnue";
      console.warn(`[AI] ${op} : ${message}`);
      await log(req.userId, op, model, system.length + user.length, 0, false, message, started);
      throw new AiCallError("Le service d'IA est momentanément indisponible. Réessayez dans un instant.");
    }

    const parsed = parseJsonLoose<unknown>(text);
    const checked = parsed == null ? null : req.schema.safeParse(parsed);
    if (checked?.success) {
      await log(req.userId, op, model, system.length + user.length, text.length, true, undefined, started);
      return { data: checked.data, model };
    }
    lastIssue = parsed == null ? "JSON illisible" : checked!.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "racine"} : ${i.message}`).join(" ; ");
    await log(req.userId, op, model, system.length + user.length, text.length, false, `Réponse invalide : ${lastIssue}`, started);
    // Réparation : on rappelle avec la liste des problèmes (sans renvoyer le document)
    user = `${req.user}\n\nTa réponse précédente était invalide (${lastIssue}). Corrige-la et respecte strictement le format JSON demandé.`;
    if (attempt === 0) await checkQuota(req.userId);
  }
  throw new AiCallError("Le modèle n'a pas produit une réponse exploitable. Réessayez.");
}
