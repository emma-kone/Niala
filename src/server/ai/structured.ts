import type { ZodType } from "zod";
import { db } from "@/lib/db";
import { parseJsonDetailed } from "./json";
import { AiCallError, AiQuotaError, AiUnavailableError, getFallbackProviders, getProvider, isTransientAiFailure, type AiFailureKind, type AiProvider, type CompletionResult } from "./provider";

// ─────────────────────────────────────────────────────────────────────────────
// Appel IA à sortie STRUCTURÉE : quota, délai, journal, validation stricte (zod).
// L'IA n'est jamais source de vérité : la validité d'une réponse est décidée ici, par schéma.
//
// Ce qui est fait pour qu'une demande aboutisse malgré les défaillances courantes d'un modèle :
//  - surcharge, débit dépassé, délai, réseau : nouveaux essais à délai croissant (provider.ts), puis repli sur un autre
//    modèle (getFallbackProviders) avec un délai neuf ;
//  - JSON abîmé (barres obliques des formules, saut de ligne brut, virgule finale) : réparé localement, sans nouvel appel ;
//  - réponse coupée par la limite de longueur : la partie complète est conservée, et un nouvel essai est fait avec un
//    budget de sortie doublé ; s'il échoue, la partie conservée est renvoyée plutôt que rien ;
//  - réponse hors schéma : un nouvel essai avec la liste des problèmes.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_TOKENS = 24_000;
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
  /** Fichier joint à lire par le modèle. */
  attachment?: { mime: string; data: string };
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

/** Message destiné à l'étudiant : il dit ce qui s'est passé et quoi faire, sans détail technique. */
export function aiFailureMessage(kind: AiFailureKind): string {
  switch (kind) {
    case "overload":
    case "rate_limit":
      return "Le service d'IA est très sollicité en ce moment. Rien n'est perdu : réessayez dans une minute.";
    case "timeout":
      return "Le service d'IA a mis trop de temps à répondre. Réessayez ; une demande plus courte aboutit plus vite.";
    case "network":
      return "Le service d'IA est injoignable pour le moment. Réessayez dans un instant.";
    case "refused":
      return "Le modèle a refusé de traiter ce contenu. Reformulez la demande ou choisissez un autre passage.";
    default:
      return "Le service d'IA est momentanément indisponible. Réessayez dans un instant.";
  }
}

type CallArgs = { system: string; user: string; maxTokens: number; temperature: number; timeoutMs: number; attachment?: { mime: string; data: string } };

/**
 * Appelle le modèle principal puis, sur un échec passager, les modèles de repli. Chaque modèle reçoit un délai neuf :
 * un modèle principal trop lent ne prive pas le suivant de son temps de réponse.
 */
async function completeWithFallback(chain: AiProvider[], args: CallArgs): Promise<{ res: CompletionResult; note?: string }> {
  let first: unknown;
  for (const [i, provider] of chain.entries()) {
    try {
      const res = await provider.complete({ system: args.system, user: args.user, maxTokens: args.maxTokens, temperature: args.temperature, json: true, attachment: args.attachment, signal: AbortSignal.timeout(args.timeoutMs) });
      return { res, note: i > 0 ? `Repli sur ${provider.model} : ${chain[0].model} indisponible (${first instanceof Error ? first.message : "échec"})`.slice(0, 300) : undefined };
    } catch (e) {
      first ??= e;
      if (!isTransientAiFailure(e) || i === chain.length - 1) throw first;
      console.warn(`[AI] ${provider.model} : ${e instanceof Error ? e.message : "échec"} — repli sur ${chain[i + 1].model}`);
    }
  }
  throw first ?? new AiCallError("Échec de l'appel.");
}

export async function generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
  const provider = getProvider();
  if (!provider) throw new AiUnavailableError();
  await checkQuota(req.userId);

  const chain = [provider, ...getFallbackProviders()];
  const op = `${req.op}@${req.promptVersion}`;
  const system = `${req.system}\n\nRéponds UNIQUEMENT avec un JSON valide, sans texte autour ni bloc de code.`;
  let user = req.user;
  let maxTokens = req.maxTokens ?? 6000;
  let lastIssue = "";
  /** Partie exploitable d'une réponse coupée : renvoyée si le nouvel essai n'obtient pas mieux. */
  let partial: StructuredResult<T> | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    let res: CompletionResult;
    let note: string | undefined;
    try {
      ({ res, note } = await completeWithFallback(chain, { system, user, maxTokens, temperature: req.temperature ?? 0.1, timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS, attachment: req.attachment }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur inconnue";
      const kind: AiFailureKind = e instanceof AiCallError ? e.kind : "other";
      console.warn(`[AI] ${op} : ${message}`);
      await log(req.userId, op, provider.model, system.length + user.length, 0, false, message, started);
      if (partial) return partial;
      throw new AiCallError(aiFailureMessage(kind), kind);
    }
    const { text, model } = res;

    const parsed = parseJsonDetailed<unknown>(text);
    const checked = parsed == null ? null : req.schema.safeParse(parsed.value);
    const cut = !!parsed?.truncated || (!!res.truncated && parsed == null);
    if (checked?.success && !parsed!.truncated) {
      // `error` reste vide quand tout s'est bien passé ; sinon il garde la trace de ce qui a été rattrapé (repli, réparation).
      await log(req.userId, op, model, system.length + user.length, text.length, true, note ?? (parsed!.repaired ? "JSON réparé localement (réponse acceptée)" : undefined), started);
      return { data: checked.data, model };
    }
    if (checked?.success) {
      partial = { data: checked.data, model };
      if (attempt === 1) {
        await log(req.userId, op, model, system.length + user.length, text.length, true, "Réponse coupée par la limite de longueur : partie complète conservée", started);
        return partial;
      }
    }
    lastIssue = cut ? "réponse coupée par la limite de longueur" : parsed == null || !checked || checked.success ? "JSON illisible" : checked.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "racine"} : ${i.message}`).join(" ; ");
    await log(req.userId, op, model, system.length + user.length, text.length, false, `Réponse invalide : ${lastIssue}`, started);
    if (cut) {
      // Réponse trop longue pour le budget de sortie : même demande, budget doublé, consigne de concision.
      maxTokens = Math.min(maxTokens * 2, Math.max(MAX_OUTPUT_TOKENS, maxTokens));
      user = `${req.user}\n\nTa réponse précédente a été coupée avant la fin (trop longue). Réponds à nouveau avec un JSON COMPLET, en restant concis dans chaque champ.`;
    } else {
      // Réparation : on rappelle avec la liste des problèmes (sans renvoyer le document)
      user = `${req.user}\n\nTa réponse précédente était invalide (${lastIssue}). Corrige-la et respecte strictement le format JSON demandé.`;
    }
    if (attempt === 0) await checkQuota(req.userId);
  }
  if (partial) return partial;
  throw new AiCallError("Le modèle n'a pas produit une réponse exploitable. Réessayez.");
}
