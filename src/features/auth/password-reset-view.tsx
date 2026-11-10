"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";
import { NialaLogo } from "@/components/brand/niala-logo";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_PASSWORD_LENGTH = 10;
const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : "Une erreur est survenue. Réessayez.");

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex justify-center"><NialaLogo size="lg" wordmarkAs="h1" /></div>
          <section className="space-y-4 rounded-3xl border bg-card p-6 shadow-sm" aria-labelledby="reset-title">
            <h2 id="reset-title" className="typo-h2">{title}</h2>
            {children}
          </section>
          <p className="mt-4 text-center text-sm"><Link href={routes.login} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Retour à la connexion</Link></p>
        </div>
      </main>
    </div>
  );
}

/** Étape 1 : l'étudiant indique son adresse. La réponse ne révèle jamais si un compte existe. */
export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<null | "email" | "team">(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ delivery: "email" | "team" }>("/api/auth/password/forgot", { email });
      setSent(r.delivery);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Frame title="Demande enregistrée">
        <p className="flex gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          {sent === "email"
            ? "Si un compte Niala utilise cette adresse, un e-mail contenant un lien de réinitialisation vient d'être envoyé. Le lien est valable 30 minutes."
            : "Si un compte Niala utilise cette adresse, l'équipe Niala a reçu votre demande et vous transmettra un lien de réinitialisation. Une fois reconnecté, vous pourrez suivre cette demande dans le module Suggestions."}
        </p>
      </Frame>
    );
  }
  return (
    <Frame title="Mot de passe oublié">
      <form onSubmit={submit} className="space-y-4">
        <p className="typo-meta">Indiquez l&apos;adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
        <div className="space-y-2">
          <Label htmlFor="forgot-email">Adresse e-mail</Label>
          <Input id="forgot-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr" />
        </div>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
        <Button type="submit" className="w-full gap-2 font-semibold" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} Recevoir un lien
        </Button>
      </form>
    </Frame>
  );
}

/** Étape 2 : le jeton est dans le fragment (#) du lien, jamais transmis au serveur dans l'adresse ni dans les journaux. */
export function ResetPasswordView() {
  const [token] = useState(() => (typeof window === "undefined" ? "" : window.location.hash.slice(1)));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`);
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/password/reset", { token, password });
      history.replaceState(null, "", window.location.pathname);
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Frame title="Mot de passe modifié">
        <p className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> Votre nouveau mot de passe est enregistré. Vos appareils ont été déconnectés par sécurité.</p>
        <Button asChild className="w-full"><Link href={routes.login}>Se connecter</Link></Button>
      </Frame>
    );
  }
  if (!token) {
    return (
      <Frame title="Lien incomplet">
        <p className="text-sm">Ce lien de réinitialisation est incomplet. Ouvrez le lien reçu en entier, ou faites une nouvelle demande.</p>
        <Button asChild variant="outline" className="w-full"><Link href={routes.forgotPassword}>Nouvelle demande</Link></Button>
      </Frame>
    );
  }
  return (
    <Frame title="Nouveau mot de passe">
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="reset-password">Nouveau mot de passe</Label>
          <Input id="reset-password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="typo-meta">{MIN_PASSWORD_LENGTH} caractères minimum.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="reset-confirm">Confirmez le mot de passe</Label>
          <Input id="reset-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
        <Button type="submit" className="w-full gap-2 font-semibold" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />} Enregistrer
        </Button>
      </form>
    </Frame>
  );
}
