import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listNotifications, markNotificationsRead } from "@/server/admin/support";

export async function GET() {
  return handle(async () => listNotifications((await requireUser()).id));
}

/** Marque des notifications (ou toutes) comme lues. */
export async function POST(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 100) : undefined;
    return markNotificationsRead(user.id, ids);
  });
}
