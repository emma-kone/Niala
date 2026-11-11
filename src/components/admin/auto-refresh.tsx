"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Actualisation des données en arrière-plan : la page n'est pas rechargée, seules les données serveur sont relues
// (router.refresh conserve l'état local, les saisies et la position de défilement). Elle ne tourne que lorsque l'onglet est
// visible, se rattrape au retour sur l'onglet et se met en pause si l'administrateur est en train de saisir du texte.

const INTERVAL_MS = 60_000;
const MIN_GAP_MS = 20_000;

/** Une saisie en cours (formulaire, éditeur) ne doit jamais être perturbée par une actualisation. */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
}

export function AutoRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [at, setAt] = useState<Date | null>(null);
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    const refresh = (force = false) => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (!force && (isTyping() || Date.now() - last.current < MIN_GAP_MS)) return;
      last.current = Date.now();
      start(() => {
        router.refresh();
        setAt(new Date());
      });
    };
    const timer = window.setInterval(() => refresh(), INTERVAL_MS);
    const onVisible = () => Date.now() - last.current >= INTERVAL_MS && refresh();
    const onManual = () => refresh(true);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("niala:admin-refresh", onManual);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("niala:admin-refresh", onManual);
    };
  }, [router, pathname]);

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("niala:admin-refresh"))}
      title={at ? `Actualisé à ${at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · actualisation automatique chaque minute` : "Actualisation automatique chaque minute · cliquer pour actualiser maintenant"}
      aria-label="Actualiser les données"
      className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} aria-hidden />
    </button>
  );
}
