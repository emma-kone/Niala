import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { handle, limit, readJson } from "@/lib/api-helpers";
import { registerUser, signupSchema } from "@/server/services/accounts";

/** Inscription par e-mail et mot de passe : le compte est connecté dès sa création. */
export async function POST(req: Request) {
  return handle(async () => {
    limit("register", 20, 60_000);
    const user = await registerUser(signupSchema.parse(await readJson<unknown>(req)));
    await setSessionCookie(user.id);
    return NextResponse.json({ ok: true, user });
  });
}
