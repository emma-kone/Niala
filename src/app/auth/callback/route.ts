import { NextResponse } from "next/server";
import { setLinkCookie, setSessionCookie } from "@/lib/auth";
import { limit } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { GoogleSignInError, type GoogleProfile, googleProfileOf, signInWithGoogle } from "@/server/services/accounts";

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

  let profile: GoogleProfile | null = null;
  try {
    profile = googleProfileOf(data.user);
    if (!profile) return fail("failed");
    const user = await signInWithGoogle(profile);
    await setSessionCookie(user.id);
    // Un compte tout juste créé par Google n'a pas encore de parcours : on l'amène directement à son profil.
    return NextResponse.redirect(`${origin}${(user as { created?: boolean }).created ? "/profil" : "/"}`);
  } catch (e) {
    if (e instanceof GoogleSignInError && e.reason === "account_exists" && profile) {
      // Compte à mot de passe : l'étudiant confirme son mot de passe Niala pour lier Google à ce compte.
      await setLinkCookie({ sub: profile.sub, email: profile.email, name: profile.name });
      return NextResponse.redirect(`${origin}/auth/link`);
    }
    if (e instanceof GoogleSignInError) return fail(e.reason === "account_conflict" ? "failed" : e.reason);
    console.error("[auth] connexion Google impossible :", e instanceof Error ? e.message : e);
    return fail("failed");
  } finally {
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}
