import { handle } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { listRequests, requestCounts } from "@/server/admin/support";

export async function GET(req: Request) {
  return handle(async () => {
    await requireAdmin("support.view");
    return { ...(await listRequests(Object.fromEntries(new URL(req.url).searchParams))), counts: await requestCounts() };
  });
}
