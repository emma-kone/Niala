import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { clientIp, handle, limit, readJson } from "@/lib/api-helpers";
import { registerUser, signupSchema } from "@/server/services/accounts";
import { track } from "@/server/analytics/track";

/** Inscription par e-mail et mot de passe : le compte est connecté dès sa création. */
export async function POST(req: Request) {
  return handle(async () => {
    limit(`register:${clientIp(req)}`, 5, 10 * 60_000);
    const user = await registerUser(signupSchema.parse(await readJson<unknown>(req)));
    await setSessionCookie(user.id);
    track(user.id, "account.register", { props: { method: "password" } });
    return NextResponse.json({ ok: true, user });
  });
}
