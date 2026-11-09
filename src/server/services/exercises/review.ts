import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ApiHttpError } from "@/lib/api-helpers";
import { AiCallError, AiQuotaError, AiUnavailableError } from "@/server/ai/provider";
import { UNTRUSTED_RULES, wrapUntrusted } from "@/server/ai/guard";
import { generateStructured } from "@/server/ai/structured";
import { getAttempt, ownedAttempt, type Snapshot } from "./attempts";

// Bilan final d'une tentative : l'IA explique les résultats déjà établis par le correcteur, sans jamais les modifier.

export const REVIEW_PROMPT_VERSION = "attempt-review-v1";
const MAX_ANSWER_CHARS = 1200;

const reviewSchema = z.object({
  overview: z.string().trim().min(1).max(1500),
  strengths: z.array(z.string().trim().min(1).max(300)).max(5).catch([]),
  priorities: z.array(z.object({ topic: z.string().trim().min(1).max(160), advice: z.string().trim().min(1).max(500) })).max(5).catch([]),
  questions: z.array(z.object({ position: z.number().int().min(1), comment: z.string().trim().min(1).max(900) })).max(40).catch([]),
});
export type AttemptReview = z.infer<typeof reviewSchema>;

const SYSTEM = `Tu es un enseignant bienveillant et précis. Tu rédiges en français le bilan d'un exercice déjà corrigé.
${UNTRUSTED_RULES}

Règles :
1. Les verdicts et les points sont définitifs : ne les modifie pas et ne les contredis pas.
2. Appuie-toi uniquement sur les données fournies (énoncés, réponses, réponses attendues, explications et extraits du cours). N'invente aucune notion.
3. "overview" : bilan global en 3 à 5 phrases, adressé à l'étudiant en le vouvoyant.
4. "strengths" : ce qui est réellement réussi, d'après les questions correctes. Liste vide si rien ne le montre.
5. "priorities" : les points à retravailler, du plus important au moins important, avec un conseil concret.
6. "questions" : pour chaque question NON réussie, un commentaire qui explique pourquoi la réponse donnée ne convient pas et comment raisonner.
Réponse : {"overview":"...","strengths":["..."],"priorities":[{"topic":"...","advice":"..."}],"questions":[{"position":1,"comment":"..."}]}`;

const excerpt = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > MAX_ANSWER_CHARS ? `${text.slice(0, MAX_ANSWER_CHARS)}…` : text;
};

export async function reviewAttempt(userId: string, attemptId: string) {
  const attempt = await ownedAttempt(userId, attemptId);
  if (attempt.status !== "GRADED") throw new ApiHttpError("Le bilan est disponible une fois la tentative corrigée.", 409);
  const snapshot = attempt.snapshot as unknown as Snapshot;
  if (snapshot.review) return getAttempt(userId, attemptId);

  const answers = new Map(attempt.answers.map((a) => [a.position, a]));
  const facts = snapshot.questions.map((q) => {
    const answer = answers.get(q.position);
    const feedback = answer?.feedback as { expected?: unknown; explanation?: string | null } | null | undefined;
    return { position: q.position, type: q.type, enonce: q.payload.statement, verdict: answer?.verdict ?? "skipped", points: answer?.points ?? 0, max: q.points, reponse_etudiant: excerpt(answer?.value), reponse_attendue: excerpt(feedback?.expected), explication: feedback?.explanation ?? q.explanation, extraits_cours: q.sourceRefs.map((s) => s.quote), notions: q.concepts.map((c) => c.name) };
  });
  const user = `Exercice : ${snapshot.exercise.title}\nScore : ${attempt.score ?? 0} / ${attempt.maxScore ?? snapshot.exercise.totalPoints}\n\n${wrapUntrusted("copie", JSON.stringify(facts))}`;

  let review: AttemptReview;
  try {
    review = (await generateStructured({ userId, op: "attempt.review", promptVersion: REVIEW_PROMPT_VERSION, system: SYSTEM, user, schema: reviewSchema, maxTokens: 5000, temperature: 0.3 })).data;
  } catch (e) {
    if (e instanceof AiQuotaError) throw new ApiHttpError(e.message, 429);
    if (e instanceof AiUnavailableError) throw new ApiHttpError("Le bilan nécessite le service d'IA, qui n'est pas configuré.", 503);
    if (e instanceof AiCallError) throw new ApiHttpError("Le bilan n'a pas pu être rédigé. Réessayez dans un instant.", 502);
    throw e;
  }
  const known = new Set(snapshot.questions.map((q) => q.position));
  const kept: AttemptReview = { ...review, questions: review.questions.filter((c) => known.has(c.position)) };
  await db.exerciseAttempt.update({ where: { id: attemptId }, data: { snapshot: { ...snapshot, review: kept } as unknown as Prisma.InputJsonValue } });
  return getAttempt(userId, attemptId);
}
