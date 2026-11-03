import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { labCapabilities } from "@/server/services/labs/labs";

export async function GET() {
  return handle(async () => {
    await requireUser();
    return labCapabilities();
  });
}
