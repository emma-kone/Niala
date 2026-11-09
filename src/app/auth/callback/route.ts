import { NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { limit } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { GoogleSignInError, googleProfileOf, signInWithGoogle } from "@/server/services/accounts";

// Retour de Supabase Auth après Google. Supabase authentifie ; Niala garde sa propre session (cookie signé et table User),
// sur laquelle reposent toutes les routes protégées. La session Supabase temporaire est fermée une fois le compte identifié.
export async function GET(req: Request) {
  const { origin, searchParams } = new URL(req.url);
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=google_${reason}`);

  if (searchParams.get("error")) return fail("cancelled");
  const code = searchParams.get("code");
  if (!code) return fail("failed");

  try {
    limit("google-callback", 60, 60_000);
  } catch {
    return fail("failed");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth] échange du code Supabase impossible :", error?.message ?? "utilisateur absent");
    return fail("failed");
  }

  try {
    const profile = googleProfileOf(data.user);
    if (!profile) return fail("failed");
    const user = await signInWithGoogle(profile);
    await setSessionCookie(user.id);
    return NextResponse.redirect(`${origin}/`);
  } catch (e) {
    if (e instanceof GoogleSignInError) return fail(e.reason);
    console.error("[auth] connexion Google impossible :", e instanceof Error ? e.message : e);
    return fail("failed");
  } finally {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
