import { handle, readJson } from "@/lib/api-helpers";
import { requireAdmin } from "@/server/admin/session";
import { createRoadmapItem, listRoadmap } from "@/server/admin/support";

export async function GET() {
  return handle(async () => {
    await requireAdmin("support.view");
    return { items: await listRoadmap() };
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin("support.manage");
    return createRoadmapItem(admin, await readJson<unknown>(req));
  });
}
