import { NextResponse } from "next/server";
import { setLinkCookie, setSessionCookie } from "@/lib/auth";
import { clientIp, limitDurable } from "@/lib/api-helpers";
import { createClient } from "@/lib/supabase/server";
import { GoogleSignInError, type GoogleProfile, googleProfileOf, signInWithGoogle } from "@/server/services/accounts";
import { cookies } from "next/headers";
import { loginAdminWithGoogle } from "@/server/admin/auth";
import { ADMIN_INTENT_COOKIE, adminLoginPath, requestMeta, setAdminCookie } from "@/server/admin/session";
import { track } from "@/server/analytics/track";

/** Vrai (et consomme le cookie) si la connexion Google a été lancée depuis l'écran d'administration. */
async function takeAdminIntent(): Promise<boolean> {
  try {
    const jar = await cookies();
    if (jar.get(ADMIN_INTENT_COOKIE)?.value !== "1") return false;
    jar.set(ADMIN_INTENT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return true;
  } catch {
    return false; // hors requête (tests) : connexion étudiante ordinaire
  }
}

// Retour de Supabase Auth après Google. Supabase authentifie ; Niala garde sa propre session (cookie signé et table User),
// sur laquelle reposent toutes les routes protégées. La session Supabase temporaire est fermée une fois le compte identifié.
export async function GET(req: Request) {
  const { origin, searchParams } = new URL(req.url);
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=google_${reason}`);

  if (searchParams.get("error")) return fail("cancelled");
  const code = searchParams.get("code");
  if (!code) return fail("failed");

  try {
    await limitDurable(`google-callback:${clientIp(req)}`, 20, 60_000);
  } catch {
    return fail("failed");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.error("[auth] échange du code Supabase impossible :", error?.message ?? "utilisateur absent");
    return fail("failed");
  }

  // Départ depuis l'écran d'administration : session d'administration, jamais de création de compte.
  if (await takeAdminIntent()) {
    try {
      const adminProfile = googleProfileOf(data.user);
      if (!adminProfile) return NextResponse.redirect(`${origin}${adminLoginPath}?error=denied`);
      const meta = await requestMeta();
      const result = await loginAdminWithGoogle(adminProfile, meta);
      await setAdminCookie(result.userId, result.version);
      return NextResponse.redirect(`${origin}${result.landing}`);
    } catch {
      return NextResponse.redirect(`${origin}${adminLoginPath}?error=denied`);
    } finally {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    }
  }

  let profile: GoogleProfile | null = null;
  try {
    profile = googleProfileOf(data.user);
    if (!profile) return fail("failed");
    const user = await signInWithGoogle(profile);
    await setSessionCookie(user.id);
    const created = (user as { created?: boolean }).created === true;
    track(user.id, created ? "account.register" : "auth.login", { props: { method: "google" } });
    // Dans tous les cas, on arrive sur le tableau de bord : un compte Google sans parcours y voit une fenêtre l'invitant à le compléter.
    return NextResponse.redirect(`${origin}/`);
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
