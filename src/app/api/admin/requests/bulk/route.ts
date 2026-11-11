import { z } from "zod";
import { handle, readJson } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { requireAdmin } from "@/server/admin/session";
import { bulkUpdateStatus, deleteRequests } from "@/server/admin/support";

const schema = z.object({ action: z.enum(["delete", "status"]) }).passthrough();

/** Traitement d'une sélection de demandes : changement de statut (ex. clôture) ou suppression. */
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    const body = await readJson<Record<string, unknown>>(req);
    const { action } = schema.parse(body);
    return action === "delete" ? deleteRequests(admin, body) : bulkUpdateStatus(admin, body, appOrigin(req));
  });
}
