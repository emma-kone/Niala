import { handle, limit, readJson } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { confirmAction } from "@/server/admin/assistant/assistant";
import { PERMISSIONS } from "@/server/admin/rbac";
import { requireAdmin } from "@/server/admin/session";

export const maxDuration = 300;

/** Exécute une action proposée par l'assistant, après confirmation explicite de l'administrateur. */
export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin([...PERMISSIONS]);
    limit(`admin-assistant-confirm:${admin.id}`, 30, 60_000);
    // La permission propre à l'action est revérifiée dans confirmAction.
    return confirmAction(await readJson<unknown>(req), appOrigin(req));
  });
}
