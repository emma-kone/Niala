import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { getProvider } from "@/server/ai/provider";
import { webStatus } from "@/server/ai/web-search";

/** État du service d'IA (configuré ou non) — sans exposer de secret. */
export async function GET() {
  return handle(async () => {
    await requireUser();
    const p = getProvider();
    const backend = p ? await webStatus() : null;
    return { configured: !!p, model: p?.model ?? null, chat: !!p?.converse, web: { available: backend !== null, backend } };
  });
}
