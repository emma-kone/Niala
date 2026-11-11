import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/api-helpers";
import { pushPublicKey, removeSubscription, saveSubscription } from "@/server/push";

/** Clé publique d'abonnement (null si les notifications push ne sont pas configurées). */
export async function GET() {
  return handle(async () => {
    await requireUser();
    return { publicKey: pushPublicKey() };
  });
}

/** Abonne l'appareil courant aux notifications push de l'étudiant connecté. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    return saveSubscription(user.id, await readJson<unknown>(req), req.headers.get("user-agent"));
  });
}

/** Désabonne l'appareil courant. */
export async function DELETE(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const { endpoint } = await readJson<{ endpoint?: string }>(req);
    return removeSubscription(user.id, String(endpoint ?? ""));
  });
}
