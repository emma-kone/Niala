import { handle, readJson } from "@/lib/api-helpers";
import { previewAnnouncement } from "@/server/admin/comms";
import { requireAdmin } from "@/server/admin/session";

export async function POST(req: Request) {
  return handle(async () => {
    await requireAdmin("comms.send");
    return previewAnnouncement(await readJson<unknown>(req));
  });
}
