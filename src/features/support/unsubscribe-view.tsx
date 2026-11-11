"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Loader2, MailX } from "lucide-react";
import { NialaLogo } from "@/components/brand/niala-logo";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client-api";
import { routes } from "@/config/routes";

/** Désinscription des annonces par e-mail, depuis le lien présent dans chaque e-mail (sans connexion). */
export function UnsubscribeView({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function confirm() {
    setState("busy");
    try {
      await api.post("/api/desinscription", { token });
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Désinscription impossible.");
      setState("error");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center"><NialaLogo size="lg" wordmarkAs="h1" /></div>
        <section className="space-y-4 rounded-3xl border bg-card p-6 shadow-sm">
          <h2 className="typo-h2 flex items-center gap-2"><MailX className="h-5 w-5 text-primary" aria-hidden />Annonces par e-mail</h2>
          {state === "done" ? (
            <p className="flex gap-2 text-sm"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />C&apos;est fait : vous ne recevrez plus les annonces de l&apos;équipe Niala par e-mail. Vous pouvez les réactiver dans Paramètres → Notifications.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Vous ne recevrez plus les annonces de l&apos;équipe Niala (nouveautés, maintenance) par e-mail. Elles resteront visibles dans Niala, et les e-mails liés à votre compte (mot de passe, assistance) continueront d&apos;arriver.</p>
              {state === "error" && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button className="w-full gap-2" disabled={!token || state === "busy"} onClick={() => void confirm()}>{state === "busy" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Me désinscrire</Button>
              {!token && <p className="text-sm text-destructive">Lien incomplet : ouvrez le lien présent dans l&apos;e-mail.</p>}
            </>
          )}
        </section>
        <p className="mt-4 text-center text-sm"><Link href={routes.login} className="text-muted-foreground hover:underline">Aller sur Niala</Link></p>
      </div>
    </div>
  );
}
