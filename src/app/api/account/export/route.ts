import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handle, limit } from "@/lib/api-helpers";
import { exportAccount } from "@/server/services/profile";

/** Téléchargement des données personnelles au format JSON. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    limit(`account-export:${user.id}`, 5, 60_000);
    return new NextResponse(JSON.stringify(await exportAccount(user.id), null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="mes-donnees-niala.json"', "Cache-Control": "no-store" },
    });
  });
}
