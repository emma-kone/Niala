import { AiCallError, getProvider } from "@/server/ai/provider";
import { checkQuota } from "@/server/ai/structured";
import { db } from "@/lib/db";
import type { ExtractResult } from "@/lib/extraction";
import { mimeFor, type DocKind } from "@/server/domain/file-validation";

// Lecture des images importées : le texte est transcrit par le modèle de vision (Gemini), puis indexé comme n'importe
// quel autre document. L'original reste l'image ; la transcription est toujours présentée comme « lue par l'IA ».

const MAX_INLINE_BYTES = 14 * 1024 * 1024; // limite de requête Gemini (~20 Mo) après encodage base64

const noText = (warning: string): ExtractResult => ({ text: "", meta: { warnings: [warning] } });

export async function extractImage(userId: string, kind: DocKind, buffer: Buffer): Promise<ExtractResult> {
  const provider = getProvider();
  if (!provider?.readImage) return noText("Le texte de cette image n'a pas pu être lu : le service d'IA n'est pas configuré (GEMINI_API_KEY). L'image reste consultable.");
  if (buffer.length > MAX_INLINE_BYTES) return noText("Image trop lourde pour être lue par l'IA (14 Mo maximum). Elle reste consultable.");
  const started = Date.now();
  try {
    await checkQuota(userId);
    const text = (await provider.readImage(buffer, mimeFor(kind), AbortSignal.timeout(90_000))).trim();
    await db.aIUsageLog.create({ data: { userId, op: "import.image@1", model: provider.model, promptChars: 0, respChars: text.length, ok: true, durationMs: Date.now() - started } }).catch(() => undefined);
    if (text.replace(/\s/g, "").length < 20) return noText("Aucun texte lisible n'a été trouvé dans cette image. Elle reste consultable.");
    return {
      text: `--- Page 1 ---\n\n${text}`,
      pageCount: 1,
      meta: { warnings: ["Texte lu par l'IA à partir de l'image : la transcription peut contenir des erreurs."] },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "erreur";
    await db.aIUsageLog.create({ data: { userId, op: "import.image@1", model: provider.model, promptChars: 0, respChars: 0, ok: false, error: message.slice(0, 300), durationMs: Date.now() - started } }).catch(() => undefined);
    return noText(e instanceof AiCallError ? "La lecture de l'image par l'IA a échoué : elle reste consultable, réessayez plus tard." : "Quota d'IA atteint ou service indisponible : l'image reste consultable.");
  }
}
