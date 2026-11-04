import { db } from "@/lib/db";
import { getProvider } from "@/server/ai/provider";

// ─────────────────────────────────────────────────────────────────────────────
// Indexation sémantique progressive : les passages sont vectorisés par lots, dans la limite d'un budget
// de temps. Ce qui n'est pas encore vectorisé reste trouvable par mots-clés ; l'état est toujours
// rapporté honnêtement (jamais « tout indexé » si ce n'est pas le cas).
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexState {
  total: number;
  embedded: number;
  available: boolean;
}

export async function indexState(userId: string, versionId: string): Promise<IndexState> {
  const model = getProvider()?.embeddingModel;
  const total = await db.documentChunk.count({ where: { userId, versionId } });
  if (!model) return { total, embedded: 0, available: false };
  const embedded = await db.documentChunk.count({ where: { userId, versionId, embeddingModel: model } });
  return { total, embedded, available: true };
}

/** Vectorise les passages manquants d'une version, jusqu'à épuisement du budget. Ne lève jamais. */
export async function embedPending(userId: string, versionId: string, budgetMs = 20_000): Promise<IndexState> {
  const provider = getProvider();
  if (!provider?.embed || !provider.embeddingModel) return indexState(userId, versionId);
  const model = provider.embeddingModel;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const rows = await db.documentChunk.findMany({
      where: { userId, versionId, OR: [{ embeddingModel: null }, { embeddingModel: { not: model } }] },
      orderBy: { idx: "asc" },
      select: { id: true, content: true },
      take: 50,
    });
    if (!rows.length) break;
    const started = Date.now();
    try {
      const vectors = await provider.embed(rows.map((r) => r.content), "document", AbortSignal.timeout(Math.max(5_000, deadline - Date.now())));
      await db.$transaction(rows.map((r, i) => db.documentChunk.update({ where: { id: r.id }, data: { embedding: vectors[i], embeddingModel: model } })));
      await db.aIUsageLog
        .create({ data: { userId, op: "index.embed@1", model, promptChars: rows.reduce((a, r) => a + r.content.length, 0), respChars: 0, ok: true, durationMs: Date.now() - started } })
        .catch(() => undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : "erreur";
      console.warn("[index] vectorisation interrompue :", message);
      await db.aIUsageLog.create({ data: { userId, op: "index.embed@1", model, promptChars: 0, respChars: 0, ok: false, error: message.slice(0, 300), durationMs: Date.now() - started } }).catch(() => undefined);
      break;
    }
  }
  return indexState(userId, versionId);
}
