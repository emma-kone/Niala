"use client";

import { useActionState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { NialaLogo } from "@/components/brand/niala-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitAccessCode, type GateState } from "./actions";

export function GateForm() {
  const [state, action, pending] = useActionState<GateState, FormData>(submitAccessCode, { error: null });
  return (
    <div className="flex min-h-screen flex-col bg-[#1c1530] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(128,97,179,0.35),transparent)]">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-white">
            <NialaLogo size="lg" tone="accent" wordmarkAs="h1" className="[&_*]:text-inherit" />
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.16em] text-white/70"><KeyRound className="h-3.5 w-3.5" aria-hidden />Accès restreint</p>
          </div>
          <form action={action} className="space-y-4 rounded-3xl border bg-card p-6 shadow-2xl" aria-labelledby="gate-title">
            <div>
              <h2 id="gate-title" className="typo-h2">Code d&apos;accès</h2>
              <p className="mt-1 text-sm text-muted-foreground">Saisissez le code pour continuer vers la connexion.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input id="code" name="code" type="password" required autoFocus autoComplete="off" spellCheck={false} maxLength={200} />
            </div>
            {state.error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>{pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Continuer"}</Button>
          </form>
        </div>
      </main>
    </div>
  );
}
