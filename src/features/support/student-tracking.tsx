"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { NOTIFICATIONS_KEY, fetchNotifications, prefetchSuggestions } from "./support-data";
import { notify } from "@/components/notifications";

// Suivi d'usage côté navigateur (balises légères, sans attente ni effet sur l'interface) et rappel des notifications de l'équipe.
// Aucun contenu ni URL complète n'est transmis : seulement le module ouvert, ou la durée de chargement de la page.

type Module = "dashboard" | "subjects" | "agenda" | "exercises" | "code" | "sql" | "assistant" | "notes" | "progress" | "settings" | "suggestions" | "profile";

function classify(pathname: string): { type: "module.open" | "course.view" | "progress.view"; module: Module } | null {
  if (/^\/matieres\/[^/]+\/documents\/[^/]+/.test(pathname)) return { type: "course.view", module: "subjects" };
  if (pathname === "/progression") return { type: "progress.view", module: "progress" };
  const first = pathname.split("/")[1] ?? "";
  const map: Record<string, Module> = { "": "dashboard", matieres: "subjects", agenda: "agenda", exercices: "exercises", code: "code", sql: "sql", assistant: "assistant", notes: "notes", reglages: "settings", suggestions: "suggestions", profil: "profile", bibliotheque: "subjects" };
  const target = map[first];
  return target ? { type: "module.open", module: target } : null;
}

/** Un rappel par session de navigation (le stockage peut être indisponible : on annonce alors une seule fois par chargement). */
function shouldAnnounce(): boolean {
  try {
    if (sessionStorage.getItem("niala:notified")) return false;
    sessionStorage.setItem("niala:notified", "1");
  } catch {
    /* stockage indisponible */
  }
  return true;
}

function beacon(body: Record<string, unknown>) {
  // keepalive : l'envoi survit à un changement de page ; les erreurs sont ignorées, la collecte ne gêne jamais l'étudiant.
  fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", keepalive: true }).catch(() => undefined);
}

export function StudentTracking() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const last = useRef<string>("");
  const loadSent = useRef(false);
  const announced = useRef(false);

  useEffect(() => {
    const c = classify(pathname);
    // Une seule balise par page ouverte : un rechargement ou une navigation interne vers la même page n'est pas recompté.
    const key = c ? `${c.type}:${c.module}:${pathname.startsWith("/matieres/") ? pathname : ""}` : "";
    if (c && key !== last.current) {
      last.current = key;
      beacon({ type: c.type, module: c.module });
    }
  }, [pathname]);

  useEffect(() => {
    if (loadSent.current) return;
    loadSent.current = true;
    const send = () => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const c = classify(location.pathname);
      if (nav && nav.loadEventEnd > 0) beacon({ type: "page.load", module: c?.module, durationMs: Math.min(120_000, Math.round(nav.loadEventEnd)) });
    };
    if (document.readyState === "complete") setTimeout(send, 0);
    else window.addEventListener("load", () => setTimeout(send, 0), { once: true });
  }, []);

  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    qc.fetchQuery({ queryKey: NOTIFICATIONS_KEY, queryFn: fetchNotifications })
      .then((r) => {
        if (r.unread > 0 && shouldAnnounce()) {
          const latest = r.items.find((i) => !i.readAt);
          notify({ title: r.unread === 1 ? "Nouvelle notification de l'équipe Niala" : `${r.unread} nouvelles notifications de l'équipe Niala`, description: `${latest?.title ?? ""} — à lire dans Suggestions.`, variant: "info", durationMs: 9000 });
        }
      })
      .catch(() => undefined);
    // Une fois l'application chargée et au repos : la page Suggestions et ses données sont préparées en arrière-plan,
    // pour que le module s'ouvre aussitôt.
    const warm = () => {
      router.prefetch("/suggestions");
      prefetchSuggestions(qc);
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) idle(warm, { timeout: 4000 });
    else setTimeout(warm, 2000);
  }, [qc, router]);

  return null;
}
