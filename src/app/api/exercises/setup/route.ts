import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { isAiConfigured } from "@/server/ai/provider";
import { maxQuestions } from "@/server/domain/exercise-model";

/** Limites du formulaire de génération, indépendantes des documents choisis. */
export async function GET() {
  return handle(async () => {
    await requireUser();
    return { aiConfigured: isAiConfigured(), maxQuestions: maxQuestions() };
  });
}
