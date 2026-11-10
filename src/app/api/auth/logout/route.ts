import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";
import { track } from "@/server/analytics/track";

export async function POST() {
  return handle(async () => {
    const user = await getCurrentUser();
    if (user) track(user.id, "auth.logout");
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  });
}
