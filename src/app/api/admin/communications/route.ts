import { after } from "next/server";
import { handle, readJson } from "@/lib/api-helpers";
import { appOrigin } from "@/lib/app-origin";
import { deliverAnnouncement, publishAnnouncement } from "@/server/admin/comms";
import { requireAdmin } from "@/server/admin/session";

// Les e-mails et notifications push partent après la réponse : l'administrateur n'attend pas l'envoi de chaque message.
export const maxDuration = 300;

export async function POST(req: Request) {
  return handle(async () => {
    const admin = await requireAdmin("comms.send");
    const result = await publishAnnouncement(admin, await readJson<unknown>(req));
    if (result.channels.email || result.channels.push) {
      const origin = appOrigin(req);
      after(() => deliverAnnouncement(result.id, origin).catch((e) => console.error("[annonce] envoi hors site :", e instanceof Error ? e.message : e)));
    }
    return result;
  });
}
