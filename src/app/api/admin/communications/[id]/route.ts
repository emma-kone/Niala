import { handle } from "@/lib/api-helpers";
import { deleteAnnouncement } from "@/server/admin/comms";
import { requireAdmin } from "@/server/admin/session";

/** Supprime une annonce : elle disparaît des notifications des étudiants. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin("comms.send");
    return deleteAnnouncement(admin, (await ctx.params).id);
  });
}
