"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { NialaLogo } from "@/components/brand/niala-logo";
import { AcademicFields, EMPTY_ACADEMIC, Required, checkAcademic, type AcademicDraft } from "@/features/profile/academic-fields";
import { api } from "@/lib/client-api";
import { createClient } from "@/lib/supabase/client";
import { routes } from "@/config/routes";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Mode = "login" | "register";
type AuthUser = { id: string; email: string; name: string | null };

const MIN_PASSWORD_LENGTH = 10;

const GOOGLE_ERRORS: Record<string, string> = {
  google_cancelled: "La connexion avec Google a été annulée.",
  google_failed: "La connexion avec Google a échoué. Réessayez dans un instant.",
  google_unverified: "Votre adresse Google n'est pas vérifiée : validez-la chez Google, puis réessayez.",
  google_suspended: "Ce compte est suspendu ou désactivé. Contactez l'équipe Niala pour en savoir plus.",
  google_account_exists: "Un compte existe déjà avec cette adresse : connectez-vous avec votre mot de passe.",
};

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function LoginView() {
  const router = useRouter();
  const { authenticated, setAuthenticated } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [academic, setAcademic] = useState<AcademicDraft>(EMPTY_ACADEMIC);
  // Le formulaire n'est affiché qu'après le chargement côté navigateur : l'adresse de la page est alors disponible.
  const [error, setError] = useState<string | null>(() => (typeof window === "undefined" ? null : (GOOGLE_ERRORS[new URLSearchParams(window.location.search).get("error") ?? ""] ?? null)));
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    if (authenticated) router.replace(routes.home);
  }, [authenticated, router]);

  useEffect(() => {
    api.get<{ google: boolean }>("/api/auth/providers").then((r) => setGoogleAvailable(r.google)).catch(() => undefined);
  }, []);

  if (authenticated === null) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <main className="flex flex-1 flex-col items-center justify-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
          <p className="typo-subtitle">Chargement de Niala…</p>
        </main>
      </div>
    );
  }

  if (authenticated) return null;

  const registering = mode === "register";

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  /** Supabase conduit l'utilisateur chez Google, puis le renvoie sur /auth/callback (flux PKCE). */
  async function continueWithGoogle() {
    setGoogleLoading(true);
    setError(null);
    const { error: oauthError } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: "select_account" } },
    });
    if (oauthError) {
      setError(GOOGLE_ERRORS.google_failed);
      setGoogleLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (registering && password.length < MIN_PASSWORD_LENGTH) return setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    const checked = registering ? checkAcademic(academic) : null;
    if (checked && !checked.ok) return setError(checked.message);
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ user: AuthUser }>(registering ? "/api/auth/register" : "/api/auth/login", registering ? { name, email, password, profile: checked?.ok ? checked.value : undefined } : { email, password });
      setAuthenticated(true, res.user);
      window.location.replace(routes.home); // la mise en page serveur repart du compte qui vient de se connecter
    } catch (err) {
      setError(err instanceof Error ? err.message : registering ? "Inscription impossible." : "Échec de la connexion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className={cn("w-full transition-[max-width] duration-200", registering ? "max-w-xl" : "max-w-md")}>
          <div className="mb-8 flex justify-center">
            <NialaLogo size="lg" wordmarkAs="h1" />
          </div>

          <form onSubmit={submit} className="space-y-4 rounded-3xl border bg-card p-6 shadow-sm" aria-labelledby="auth-title">
            <h2 id="auth-title" className="typo-h2">{registering ? "Créer un compte" : "Connexion"}</h2>

            {googleAvailable && (
              <>
                <Button type="button" variant="outline" className="w-full gap-2 font-medium" disabled={googleLoading} onClick={() => void continueWithGoogle()}>
                  {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <GoogleMark />} Continuer avec Google
                </Button>
                <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
                  <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
                </div>
              </>
            )}

            {registering && (
              <div className="space-y-2">
                <Label htmlFor="name">Nom et prénom<Required /></Label>
                <Input id="name" autoComplete="name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre nom et prénom" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Adresse e-mail{registering && <Required />}</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe{registering && <Required />}</Label>
              <Input id="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={registering ? MIN_PASSWORD_LENGTH : undefined} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
              {registering ? <p className="typo-meta">{MIN_PASSWORD_LENGTH} caractères minimum.</p> : <p className="text-right text-sm"><Link href={routes.forgotPassword} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Mot de passe oublié ?</Link></p>}
            </div>
            {registering && <AcademicFields draft={academic} onChange={setAcademic} idPrefix="signup" />}
            {registering && <p className="typo-meta"><span className="text-destructive">*</span> Champ obligatoire</p>}
            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
            <Button type="submit" className="w-full gap-2 font-semibold" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : registering ? <UserPlus className="h-4 w-4" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
              {registering ? "Créer mon compte" : "Se connecter"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {registering ? "Déjà inscrit ?" : "Pas encore de compte ?"}{" "}
              <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => switchMode(registering ? "login" : "register")}>
                {registering ? "Se connecter" : "Créer un compte"}
              </button>
            </p>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            {registering ? "En créant un compte" : "En vous connectant"}, vous acceptez les{" "}
            <Link href={routes.terms} className="underline underline-offset-2 hover:text-foreground">conditions d&apos;utilisation</Link> et la{" "}
            <Link href={routes.privacy} className="underline underline-offset-2 hover:text-foreground">politique de confidentialité</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
