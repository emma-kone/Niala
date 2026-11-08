import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { listAllNotes } from "@/server/services/notes";

export async function GET() {
  return handle(async () => listAllNotes((await requireUser()).id));
}
