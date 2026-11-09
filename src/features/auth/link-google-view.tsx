"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Link2, Loader2 } from "lucide-react";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Confirmation du mot de passe Niala pour lier Google à un compte existant. */
export default function LinkGoogleView({ email }: { email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post("/api/auth/link", { password });
      // Navigation complète : l'état de connexion du client est relu avec le nouveau cookie.
      window.location.assign(routes.home);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Liaison impossible.");
      setLoading(false);
    }
  }

  async function cancel() {
    await api.del("/api/auth/link").catch(() => undefined);
    router.replace(routes.login);
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
              <GraduationCap className="h-7 w-7" aria-hidden />
            </div>
            <h1 className="typo-display">Niala</h1>
          </div>

          <form onSubmit={submit} className="space-y-4 rounded-3xl border bg-card p-6 shadow-sm" aria-labelledby="link-title">
            <h2 id="link-title" className="typo-h2">Lier votre compte Google</h2>
            <p className="typo-subtitle">
              Un compte Niala existe déjà pour <strong className="text-foreground">{email}</strong>. Saisissez son mot de passe une seule fois : ensuite, « Continuer avec Google » vous connectera directement à ce compte, avec toutes vos données.
            </p>
            <div className="space-y-2">
              <Label htmlFor="link-password">Mot de passe Niala</Label>
              <Input id="link-password" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
            </div>
            {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}
            <Button type="submit" className="w-full gap-2 font-semibold" disabled={loading || !password}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} Lier et me connecter
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => void cancel()}>Annuler</button>
            </p>
          </form>
        </div>
      </main>
      <footer className="border-t px-6 py-3 text-center text-xs text-muted-foreground">
        <Link href={routes.privacy} className="hover:text-foreground">Confidentialité</Link> · <Link href={routes.terms} className="hover:text-foreground">Conditions d&apos;utilisation</Link>
      </footer>
    </div>
  );
}
