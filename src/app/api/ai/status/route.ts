import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { getProvider } from "@/server/ai/provider";

/** État du service d'IA (configuré ou non) — sans exposer de secret. */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const p = getProvider();
    return { configured: !!p, model: p?.model ?? null };
  });
}
