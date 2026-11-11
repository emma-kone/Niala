import { handle, readJson } from "@/lib/api-helpers";
import { unsubscribeFromEmails } from "@/server/admin/comms";

/** Désinscription des annonces par e-mail : bouton de la page /desinscription, ou « un clic » des messageries (RFC 8058). */
export async function POST(req: Request) {
  return handle(async () => {
    const fromQuery = new URL(req.url).searchParams.get("t");
    const token = fromQuery ?? String((await readJson<{ token?: string }>(req)).token ?? "");
    return unsubscribeFromEmails(token);
  });
}
