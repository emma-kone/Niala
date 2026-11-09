import { z } from "zod";
import { ApiHttpError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { UNTRUSTED_RULES, wrapUntrusted } from "@/server/ai/guard";
import { AiCallError, AiQuotaError, getProvider, type ChatTurn } from "@/server/ai/provider";
import { checkQuota } from "@/server/ai/structured";
import { RELIABILITY_RULES } from "@/server/reliability/claims";
import { leaksSolution } from "./hints";

// ─────────────────────────────────────────────────────────────────────────────
// Module « assistant IA des laboratoires », commun à l'éditeur de code et au laboratoire SQL.
// Il voit le code affiché, l'énoncé, le schéma et le dernier résultat RÉEL.
//  - Espace libre, ou solution déjà révélée : il peut proposer du code.
//  - Exercice en cours : il guide sans écrire la solution, sa réponse est contrôlée avant d'être montrée,
//    et la solution de référence ne lui est jamais transmise.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CODE_CHARS = 40_000;
const CONTEXT_CODE_CHARS = 12_000;

export const assistantSchema = z.object({
  message: z.string().trim().min(1, "Message vide.").max(2000, "Message trop long."),
  code: z.string().max(MAX_CODE_CHARS),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(12).default([]),
});

interface LabFile {
  language: string;
}
interface LabBrief {
  statement?: string;
  reference?: string;
  revealedAt?: string;
  sql?: { setupSql?: string };
}
interface LabOutcome {
  name: string;
  status: string;
  hidden?: boolean;
  message?: string;
  expected?: unknown;
  actual?: unknown;
}

export type AssistantEvent = { type: "delta"; text: string };

function systemPrompt(kind: "CODE" | "SQL", language: string, guided: boolean): string {
  return `Tu es l'assistant IA intégré au ${kind === "SQL" ? "laboratoire SQL de Niala (moteur : SQLite)" : `laboratoire de code de Niala (langage : ${language})`}. Tu aides un étudiant à comprendre, corriger et améliorer ${kind === "SQL" ? "sa requête" : "son code"}. Réponds en français, de façon concise, en Markdown simple.

${RELIABILITY_RULES}
- Appuie-toi sur le code affiché et sur le dernier résultat fourni. Tu n'exécutes rien toi-même : n'affirme jamais qu'un code « fonctionne » sans résultat réel, et invite à lancer l'exécution pour vérifier.
- Si un comportement dépend d'une version ou d'un moteur, précise-le.

${
  guided
    ? `MODE EXERCICE : l'étudiant doit trouver lui-même. N'écris JAMAIS de code corrigé, de bloc de code ni la requête ou la fonction complète. Tu peux nommer un mot-clé ou une notion, expliquer une erreur, poser une question qui le met sur la voie, et décrire une démarche en français.`
    : `MODE LIBRE : tu peux proposer du code. Si tu proposes une version à utiliser, donne-la ENTIÈRE dans un seul bloc de code, avec son langage.`
}

${UNTRUSTED_RULES.replace("Ne produis que le JSON demandé, sans texte autour.", "Réponds uniquement à l'étudiant.")}`;
}

const GUIDED_FALLBACK = "Je préfère ne pas écrire la solution de cet exercice. Dites-moi quelle ligne vous bloque ou ce que vous attendiez comme résultat, et je vous mets sur la voie. Vous pouvez aussi demander un indice après avoir exécuté votre code.";

export async function askLabAssistant(userId: string, workspaceId: string, input: z.infer<typeof assistantSchema>, emit?: (e: AssistantEvent) => void) {
  const workspace = await db.labWorkspace.findFirst({ where: { id: workspaceId, userId } });
  if (!workspace) throw new ApiHttpError("Espace de travail introuvable.", 404);
  const provider = getProvider();
  if (!provider?.converse) throw new ApiHttpError("L'assistant nécessite le service d'IA Gemini, qui n'est pas configuré.", 503);
  try {
    await checkQuota(userId);
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    throw e;
  }

  const run = await db.labRun.findFirst({ where: { workspaceId, userId }, orderBy: { createdAt: "desc" } });
  const brief = (workspace.brief as unknown as LabBrief | null) ?? null;
  const language = (workspace.files as unknown as LabFile[])[0]?.language ?? (workspace.kind === "SQL" ? "sql" : "python");
  const guided = !!brief?.reference && !brief.revealedAt;

  const parts = [`Code actuellement dans l'éditeur :\n${wrapUntrusted("code", input.code.slice(0, CONTEXT_CODE_CHARS) || "(vide)")}`];
  if (brief?.statement) parts.push(`Énoncé :\n${wrapUntrusted("énoncé", brief.statement.slice(0, 3000))}`);
  const schema = brief?.sql?.setupSql ?? workspace.schemaSql;
  if (workspace.kind === "SQL" && schema) parts.push(`Schéma et données :\n${wrapUntrusted("schéma", schema.slice(0, 6000))}`);
  if (run) {
    const output = run.output as { status?: string; error?: unknown; stdout?: string; rows?: unknown[]; columns?: unknown[] };
    const tests = run.tests as { outcomes?: LabOutcome[] } | null;
    const same = (run.input as { content?: string }).content === input.code;
    const visible = (tests?.outcomes ?? []).slice(0, 10).map((o) => ({ test: o.name, statut: o.status, message: o.message, ...(o.hidden ? {} : { attendu: o.expected, obtenu: o.actual }) }));
    const summary = { statut: output.status, erreur: output.error, sortie: output.stdout?.slice(0, 2000), colonnes: output.columns, lignes: output.rows?.slice(0, 10), tests: visible.length ? visible : undefined };
    parts.push(`Dernier résultat réel (${same ? "correspond au code affiché" : "ATTENTION : obtenu avec une version antérieure du code"}) :\n${wrapUntrusted("résultat", JSON.stringify(summary).slice(0, 5000))}`);
  } else {
    parts.push("Ce code n'a encore jamais été exécuté : aucun résultat réel n'est disponible.");
  }

  const turns: ChatTurn[] = [
    ...input.history.map((m): ChatTurn => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.content }] })),
    { role: "user", parts: [{ text: `${parts.join("\n\n")}\n\nDemande de l'étudiant :\n${wrapUntrusted("question", input.message)}` }] },
  ];

  const started = Date.now();
  const system = systemPrompt(workspace.kind, language, guided);
  const log = (model: string, respChars: number, ok: boolean, error?: string) => db.aIUsageLog.create({ data: { userId, op: "lab.assistant@1", model, promptChars: system.length + input.code.length + input.message.length, respChars, ok, error: error?.slice(0, 500) ?? null, durationMs: Date.now() - started } }).catch(() => undefined);
  try {
    // En mode exercice, rien n'est diffusé avant le contrôle : une solution ne doit jamais s'afficher, même un instant.
    const res = await provider.converse({ system, turns, maxTokens: 3000, temperature: 0.2, signal: AbortSignal.timeout(90_000), onText: guided || !emit ? undefined : (d) => emit({ type: "delta", text: d }) });
    if (!res.text.trim()) throw new AiCallError("Réponse vide.");
    await log(res.model, res.text.length, true);
    return { text: guided && leaksSolution(res.text, brief?.reference) ? GUIDED_FALLBACK : res.text, guided };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    console.warn(`[lab.assistant] ${message}`);
    await log(provider.model, 0, false, message);
    throw new ApiHttpError("L'assistant est momentanément indisponible. Réessayez dans un instant.", 502);
  }
}
